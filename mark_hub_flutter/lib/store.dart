/// Hub data store (desktop SQLite via sqflite_common_ffi).
/// Versioned scores, flag inbox, hash-chained audit, backup/drill gate flags.
import 'dart:convert';
import 'package:crypto/crypto.dart' as crypto_pkg show sha256;
import 'package:cryptography/cryptography.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:uuid/uuid.dart';

import 'engine.dart';

const _schema = '''
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, short_code TEXT UNIQUE NOT NULL, first TEXT, last TEXT, class TEXT);
CREATE TABLE IF NOT EXISTS assessments(subject TEXT, label TEXT, max_score REAL, weight REAL, PRIMARY KEY(subject, label));
CREATE TABLE IF NOT EXISTS scores(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT, label TEXT, value REAL, entered_by TEXT, version INTEGER, supersedes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS flags(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT, label TEXT, rule_id TEXT, severity TEXT, message TEXT, status TEXT DEFAULT 'open', disposition TEXT, actor TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS comments(student_code TEXT, subject TEXT, term TEXT, template_id TEXT, final_text TEXT, author TEXT, PRIMARY KEY(student_code, subject, term));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, student_code TEXT, term TEXT, version INTEGER, payload TEXT, hash TEXT, signature TEXT, status TEXT, approvals TEXT);
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, action TEXT, entity TEXT, before_json TEXT, after_json TEXT, prev_hash TEXT, hash TEXT);
''';

class HubStore {
  late Database db;
  final _uuid = const Uuid();

  static Future<HubStore> open() async {
    sqfliteFfiInit();
    final dir = await getApplicationDocumentsDirectory();
    final hubDir = p.join(dir.path, 'agent-mark-hub');
    final factory = databaseFactoryFfi;
    final db = await factory.openDatabase(p.join(hubDir, 'hub.db'));
    for (final stmt in _schema.split(';')) {
      final s = stmt.trim();
      if (s.isNotEmpty) await db.execute(s);
    }
    final store = HubStore()..db = db;
    await store._ensureKeys();
    return store;
  }

  Future<void> _audit(String actor, String action, String entity, String before, String after) async {
    final prev = (await db.rawQuery('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1'))
        .map((r) => r['hash'] as String)
        .firstWhere((_) => true, orElse: () => 'GENESIS');
    final body = '$actor|$action|$entity|$before|$after|$prev';
    final hash = crypto_pkg.sha256.convert(utf8.encode(body)).toString();
    await db.insert('audit', {
      'ts': DateTime.now().toUtc().toIso8601String(), 'actor': actor, 'action': action,
      'entity': entity, 'before_json': before, 'after_json': after, 'prev_hash': prev, 'hash': hash,
    });
  }

  Future<String?> flag(String k) async =>
      (await db.query('meta', where: 'k = ?', whereArgs: [k])).map((r) => r['v'] as String).firstOrNull;
  Future<void> setFlag(String k, String v, String actor) async {
    await db.insert('meta', {'k': k, 'v': v}, conflictAlgorithm: ConflictAlgorithm.replace);
    await _audit(actor, 'flag.$k', k, 'null', v);
  }

  Future<void> _ensureKeys() async {
    if (await flag('hub_priv') == null) {
      final algo = Ed25519();
      final kp = await algo.newKeyPair();
      final priv = await kp.extractPrivateKeyBytes();
      final pub = await kp.extractPublicKey();
      await db.insert('meta', {'k': 'hub_priv', 'v': base64Encode(priv)});
      await db.insert('meta', {'k': 'hub_pub', 'v': base64Encode(pub.bytes)});
    }
    if (await flag('backup_key') == null) {
      final box = SecretBox(chacha_xchacha20_poly1305);
      final key = await box.newSecretKey();
      await db.insert('meta', {'k': 'backup_key', 'v': base64Encode(await key.extractBytes())});
    }
  }

  Future<void> seedDemo() async {
    for (final t in ['scores', 'students', 'flags', 'reports', 'comments']) {
      await db.delete(t);
    }
    const weights = [
      ('MATHS', 'CA1', 20.0, 20.0), ('MATHS', 'CA2', 20.0, 20.0), ('MATHS', 'Exam', 60.0, 60.0),
      ('ENG', 'CA', 40.0, 40.0), ('ENG', 'Exam', 60.0, 60.0),
    ];
    for (final (s, l, m, w) in weights) {
      await db.insert('assessments', {'subject': s, 'label': l, 'max_score': m, 'weight': w},
          conflictAlgorithm: ConflictAlgorithm.replace);
    }
    const names = ['Ada', 'Bola', 'Chidi', 'Dola', 'Emeka', 'Funmi'];
    for (var i = 0; i < names.length; i++) {
      final sc = '26-JSS2A-00${i + 1}';
      await db.insert('students', {'id': sc, 'short_code': sc, 'first': names[i], 'last': 'Demo', 'class': 'JSS2-A'},
          conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await _audit('system', 'seed.demo', 'school', 'null', '6 students');
  }

  Future<({List<String> errors, int count})> importRoster(String csv, {required bool dryRun}) async {
    final errors = <String>[];
    final rows = <List<String>>[];
    final lines = csv.split('\n');
    for (var i = 1; i < lines.length; i++) {
      final line = lines[i].trim();
      if (line.isEmpty) continue;
      final c = line.split(',');
      if (c.length < 4 || c[0].trim().isEmpty || c[1].trim().isEmpty || c[3].trim().isEmpty) {
        errors.add('row ${i + 1}: missing short_code/first_name/class_label');
        continue;
      }
      final sc = c[0].trim();
      if (rows.any((r) => r[0] == sc)) {
        errors.add('row ${i + 1}: duplicate short_code $sc in file');
        continue;
      }
      final exists = (await db.query('students', where: 'short_code = ?', whereArgs: [sc])).isNotEmpty;
      if (exists) {
        errors.add('row ${i + 1}: duplicate short_code $sc in db');
        continue;
      }
      rows.add([sc, c[1].trim(), c[2].trim(), c[3].trim()]);
    }
    if (!dryRun && errors.isEmpty) {
      for (final r in rows) {
        await db.insert('students', {'id': r[0], 'short_code': r[0], 'first': r[1], 'last': r[2], 'class': r[3]});
      }
      await _audit('admin', 'roster.import', 'students', 'null', '${rows.length} rows');
    }
    return (errors: errors, count: rows.length);
  }

  Future<String> addScore(String student, String subject, String label, double value, String actor) async {
    final ass = await db.query('assessments', where: 'subject = ? AND label = ?', whereArgs: [subject, label]);
    if (ass.isEmpty) throw FormatException('unknown assessment $subject/$label');
    final max = (ass.first['max_score'] as num).toDouble();
    final err = checkRange(value, max);
    if (err != null) throw FormatException(err);
    final priors = await db.query('scores', where: 'student_code = ? AND subject = ? AND label = ?', whereArgs: [student, subject, label]);
    for (final pr in priors) {
      if (((pr['value'] as num).toDouble() - value).abs() > 1e-9) {
        throw const FormatException('VAL-DUP-01: conflicting prior entry — use update flow');
      }
    }
    if (priors.isNotEmpty) return priors.first['id'] as String;
    final id = 's${_uuid.v4().substring(0, 8)}';
    await db.insert('scores', {
      'id': id, 'student_code': student, 'subject': subject, 'label': label,
      'value': value, 'entered_by': actor, 'version': 1, 'supersedes': null,
      'created_at': DateTime.now().toUtc().toIso8601String(),
    });
    await _audit(actor, 'score.add', id, 'null', '$student $subject/$label=$value');
    return id;
  }

  Future<Map<String, dynamic>> dashboard() async {
    int count(String sql) => db.rawQuery(sql).then((r) => (r.first.values.first as int));
    final students = await count('SELECT COUNT(*) FROM students');
    final scores = await count('SELECT COUNT(*) FROM scores');
    final flagsOpen = await count("SELECT COUNT(*) FROM flags WHERE status = 'open'");
    final locked = await count("SELECT COUNT(*) FROM reports WHERE status = 'locked'");
    final blocking = <String>[];
    final warning = <String>[];
    if (students == 0) blocking.add('No students imported.');
    if (await count('SELECT COUNT(*) FROM assessments') == 0) blocking.add('No assessments configured.');
    for (final r in await db.rawQuery('SELECT subject, SUM(weight) s FROM assessments GROUP BY subject')) {
      if (((r['s'] as num).toDouble() - 100.0).abs() > 1e-9) {
        blocking.add('Weights for ${r['subject']} must sum to 100%.');
      }
    }
    final bv = await flag('backup_verified') == 'yes';
    final dp = await flag('drill_passed') == 'yes';
    if (!bv) blocking.add('No verified backup. Run backup + verify first.');
    if (!dp) blocking.add('Restore drill not passed.');
    if (students > 0 && scores == 0) warning.add('No scores entered yet.');
    return {
      'students': students, 'scores': scores, 'flagsOpen': flagsOpen, 'locked': locked,
      'backup': bv, 'drill': dp, 'live': await flag('live') == 'yes',
      'blocking': blocking, 'warning': warning,
    };
  }

  Future<List<Map<String, dynamic>>> scanFlags() async {
    final students = await db.query('students');
    final ass = await db.query('assessments');
    var n = 0;
    for (final s in students) {
      for (final a in ass) {
        final has = (await db.query('scores',
                where: 'student_code = ? AND subject = ? AND label = ?',
                whereArgs: [s['short_code'], a['subject'], a['label']]))
            .isNotEmpty;
        if (!has) {
          await db.insert('flags', {
            'id': 'F-miss-${n++}', 'student_code': s['short_code'], 'subject': a['subject'],
            'label': a['label'], 'rule_id': 'VAL-MISS-01', 'severity': 'blocking',
            'message': '${a['label']} (${a['subject']}) is missing for ${s['short_code']}.', 'status': 'open',
          }, conflictAlgorithm: ConflictAlgorithm.ignore);
        }
      }
    }
    return db.query('flags', where: 'status = ?', whereArgs: ['open'], orderBy: "severity != 'blocking', id");
  }

  Future<void> disposeFlag(String id, String disp, String actor, String note) async {
    if (disp == 'confirmed' && note.trim().isEmpty) throw const FormatException('confirmed requires a reason note');
    final n = await db.update('flags', {'status': 'resolved', 'disposition': disp, 'actor': actor, 'note': note},
        where: 'id = ? AND status = ?', whereArgs: [id, 'open']);
    if (n == 0) throw const FormatException('flag not found or already resolved');
    await _audit(actor, 'flag.$disp', id, 'open', 'resolved');
  }
}
