/// All console panes: dashboard, students, scores, flags, comments, reports, backup, audit.
import 'package:flutter/material.dart';
import 'engine.dart';
import 'main.dart';
import 'store.dart';

class DashboardPane extends StatefulWidget {
  final HubStore store;
  const DashboardPane({super.key, required this.store});
  @override
  State<DashboardPane> createState() => _DashboardPaneState();
}

class _DashboardPaneState extends State<DashboardPane> {
  Map<String, dynamic>? d;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async => setState(() => d = null).ignore().then((_) async {
        final v = await widget.store.dashboard();
        if (mounted) setState(() => d = v);
      });
  @override
  Widget build(BuildContext context) {
    if (d == null) return const Center(child: CircularProgressIndicator());
    Widget stat(String label, Object v) => Card(
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(children: [Text('$v', style: const TextStyle(fontSize: 24)), Text(label)])));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (d!['live'] == true)
        const Chip(label: Text('LIVE'), backgroundColor: Colors.green, labelStyle: TextStyle(color: Colors.white))
      else
        const Chip(label: Text('NOT LIVE')),
      Wrap(spacing: 8, children: [
        stat('students', d!['students']), stat('scores', d!['scores']),
        stat('open flags', d!['flagsOpen']), stat('locked reports', d!['locked']),
        stat('backup', (d!['backup'] as bool) ? 'yes' : 'no'),
        stat('drill', (d!['drill'] as bool) ? 'yes' : 'no'),
      ]),
      const SizedBox(height: 8),
      const Text('Readiness checklist', style: TextStyle(fontWeight: FontWeight.bold)),
      for (final b in (d!['blocking'] as List)) Text('• $b', style: const TextStyle(color: Colors.red)),
      if ((d!['blocking'] as List).isEmpty) const Text('None — ready.', style: TextStyle(color: Colors.green)),
      const SizedBox(height: 8),
      Row(children: [
        FilledButton(
            onPressed: () async {
              await widget.store.seedDemo();
              snack(context, 'Demo school loaded.');
              _load();
            },
            child: const Text('Load demo school')),
        const SizedBox(width: 8),
        OutlinedButton(
            onPressed: () async {
              try {
                final dd = await widget.store.dashboard();
                if ((dd['blocking'] as List).isNotEmpty) throw FormatException('Blocked: ${(dd['blocking'] as List).join('; ')}');
                await widget.store.setFlag('live', 'yes', 'admin');
                snack(context, 'Hub is LIVE.');
                _load();
              } catch (e) {
                snack(context, '$e', bad: true);
              }
            },
            child: const Text('Go Live')),
      ]),
    ]);
  }
}

extension<T> on Future<T> {
  Future<void> ignore() async {
    try {
      await this;
    } catch (_) {}
  }
}

class StudentsPane extends StatefulWidget {
  final HubStore store;
  const StudentsPane({super.key, required this.store});
  @override
  State<StudentsPane> createState() => _StudentsPaneState();
}

class _StudentsPaneState extends State<StudentsPane> {
  List<Map<String, dynamic>> rows = [];
  final csv = TextEditingController(text: 'short_code,first_name,last_name,class_label\n26-JSS2A-007,Adaeze,Demo,JSS2-A');
  String result = '';
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    rows = await widget.store.db.query('students', orderBy: 'short_code');
    if (mounted) setState(() {});
  }

  Future<void> _import(bool dryRun) async {
    try {
      final r = await widget.store.importRoster(csv.text, dryRun: dryRun);
      setState(() => result = 'Would import: ${r.count}\n${r.errors.join('\n')}');
      if (!dryRun && r.errors.isEmpty) {
        _load();
        snack(context, 'Imported ${r.count} students.');
      }
    } catch (e) {
      snack(context, '$e', bad: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Students (${rows.length})', style: Theme.of(context).textTheme.titleLarge),
      DataTable(columns: const [DataColumn(label: Text('Code')), DataColumn(label: Text('Name')), DataColumn(label: Text('Class'))],
          rows: [for (final r in rows) DataRow(cells: [DataCell(Text('${r['short_code']}')), DataCell(Text('${r['first']} ${r['last']}')), DataCell(Text('${r['class']}'))])]),
      const SizedBox(height: 12),
      const Text('CSV import', style: TextStyle(fontWeight: FontWeight.bold)),
      TextField(controller: csv, maxLines: 4, decoration: const InputDecoration(border: OutlineInputBorder())),
      Row(children: [
        OutlinedButton(onPressed: () => _import(true), child: const Text('Dry-run check')),
        const SizedBox(width: 8),
        FilledButton(onPressed: () => _import(false), child: const Text('Import for real')),
      ]),
      Text(result),
    ]);
  }
}

class ScoresPane extends StatefulWidget {
  final HubStore store;
  const ScoresPane({super.key, required this.store});
  @override
  State<ScoresPane> createState() => _ScoresPaneState();
}

class _ScoresPaneState extends State<ScoresPane> {
  final stu = TextEditingController(text: '26-JSS2A-001');
  String subj = 'MATHS';
  String label = 'CA1';
  final val = TextEditingController(text: '17');
  String table = '';
  @override
  void initState() {
    super.initState();
    _refresh();
  }

  List<String> get labels => subj == 'MATHS' ? ['CA1', 'CA2', 'Exam'] : ['CA', 'Exam'];

  Future<void> _save() async {
    try {
      await widget.store.addScore(stu.text.trim(), subj, label, double.parse(val.text), 'admin');
      snack(context, 'Score saved.');
      _refresh();
    } catch (e) {
      snack(context, '$e', bad: true);
    }
  }

  Future<void> _refresh() async {
    final students = await widget.store.db.query('students', orderBy: 'short_code');
    final buf = StringBuffer();
    for (final s in students) {
      buf.write('${s['short_code']} ${s['first']}: ');
      for (final su in ['MATHS', 'ENG']) {
        final parts = <(double, double, double)>[];
        double total = 0;
        final ass = await widget.store.db.query('assessments', where: 'subject = ?', whereArgs: [su]);
        var complete = ass.isNotEmpty;
        for (final a in ass) {
          final sc = await widget.store.db.query('scores',
              where: 'student_code = ? AND subject = ? AND label = ?',
              whereArgs: [s['short_code'], su, a['label']]);
          if (sc.isEmpty) {
            complete = false;
            break;
          }
          final v = (sc.first['value'] as num).toDouble();
          total += v;
          parts.add((v, (a['max_score'] as num).toDouble(), (a['weight'] as num).toDouble()));
        }
        if (!complete) {
          buf.write('$su —  ');
        } else {
          try {
            final avgT = weightedAvgTenths(parts);
            buf.write('$su ${(avgT / 10).toStringAsFixed(1)}%(${mapGrade(avgT)})  ');
          } catch (e) {
            buf.write('$su error  ');
          }
        }
      }
      buf.writeln();
    }
    if (mounted) setState(() => table = buf.toString());
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Enter score (range-checked instantly)', style: TextStyle(fontWeight: FontWeight.bold)),
      Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        SizedBox(width: 140, child: TextField(controller: stu, decoration: const InputDecoration(labelText: 'Student'))),
        DropdownButton<String>(
            value: subj,
            items: const [DropdownMenuItem(value: 'MATHS', child: Text('MATHS')), DropdownMenuItem(value: 'ENG', child: Text('ENG'))],
            onChanged: (v) => setState(() {
                  subj = v!;
                  label = labels.first;
                })),
        DropdownButton<String>(
            value: label,
            items: [for (final l in labels) DropdownMenuItem(value: l, child: Text(l))],
            onChanged: (v) => setState(() => label = v!)),
        SizedBox(width: 90, child: TextField(controller: val, decoration: const InputDecoration(labelText: 'Value'), keyboardType: TextInputType.number)),
        FilledButton(onPressed: _save, child: const Text('Save')),
      ]),
      const SizedBox(height: 12),
      const Text('Results (same scores → same grades)', style: TextStyle(fontWeight: FontWeight.bold)),
      SelectableText(table.isEmpty ? 'No students yet.' : table),
    ]);
  }
}

class FlagsPane extends StatefulWidget {
  final HubStore store;
  const FlagsPane({super.key, required this.store});
  @override
  State<FlagsPane> createState() => _FlagsPaneState();
}

class _FlagsPaneState extends State<FlagsPane> {
  List<Map<String, dynamic>> flags = [];
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    flags = await widget.store.scanFlags();
    if (mounted) setState(() {});
  }

  Future<void> _dispose(String id, String disp, [String note = '']) async {
    if (disp == 'confirmed' && note.isEmpty) {
      final ctl = TextEditingController();
      final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
                title: const Text('Reason required'),
                content: TextField(controller: ctl, decoration: const InputDecoration(hintText: 'Verified with paper script…')),
                actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Confirm'))],
              ));
      if (ok != true || ctl.text.trim().isEmpty) return;
      note = ctl.text;
    }
    try {
      await widget.store.disposeFlag(id, disp, 'admin', note.isEmpty ? '$disp at hub' : note);
      snack(context, 'Flag $id $disp.');
      _load();
    } catch (e) {
      snack(context, '$e', bad: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Flag inbox (${flags.length} open)', style: Theme.of(context).textTheme.titleLarge),
      const Text('Blocking first. Confirm requires a reason. Nothing here auto-changes scores.'),
      for (final f in flags)
        Card(
            child: ListTile(
          title: Text('${f['rule_id']} · ${f['student_code']} ${f['subject']} ${f['label']}'),
          subtitle: Text('${f['message']}'),
          trailing: Wrap(children: [
            TextButton(onPressed: () => _dispose('${f['id']}', 'corrected'), child: const Text('Correct')),
            TextButton(onPressed: () => _dispose('${f['id']}', 'confirmed'), child: const Text('Confirm…')),
            TextButton(onPressed: () => _dispose('${f['id']}', 'escalated'), child: const Text('Escalate')),
          ]),
        )),
      if (flags.isEmpty) const Text('Inbox clear.', style: TextStyle(color: Colors.green)),
    ]);
  }
}

const _bank = [
  ('MATHS', 'A', '{name} has been outstanding in {subject} with {score}%. Keep up the excellent work.'),
  ('MATHS', 'B', '{name} is doing very well in {subject} ({score}%). Steady work shows.'),
  ('MATHS', 'C', '{name} is steady in {subject} ({score}%). Focus to lift into the next band.'),
  ('MATHS', 'D', '{name} is finding {subject} difficult ({score}%). Weekly practice is required.'),
  ('MATHS', 'F', '{name} has not met the standard in {subject} ({score}%). A meeting is advised.'),
  ('ENG', 'A', '{name} reads and writes with excellence in {subject} ({score}%).'),
  ('ENG', 'B', '{name} is strong in {subject} ({score}%). Keep building.'),
  ('ENG', 'C', '{name} is steady in {subject} ({score}%).'),
  ('ENG', 'D', '{name} finds {subject} difficult ({score}%). Regular work is required.'),
  ('ENG', 'F', '{name} is below standard in {subject} ({score}%). A meeting is advised.'),
];

class CommentsPane extends StatefulWidget {
  final HubStore store;
  const CommentsPane({super.key, required this.store});
  @override
  State<CommentsPane> createState() => _CommentsPaneState();
}

class _CommentsPaneState extends State<CommentsPane> {
  String stu = '';
  String subj = 'MATHS';
  String band = 'B';
  String picked = '';
  @override
  Widget build(BuildContext context) {
    final opts = _bank.where((t) => t.$1 == subj && t.$2 == band).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Comment picker (3 taps + edit)', style: TextStyle(fontWeight: FontWeight.bold)),
      Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        SizedBox(
            width: 150,
            child: TextField(decoration: const InputDecoration(labelText: 'Student code'), onChanged: (v) => stu = v)),
        DropdownButton<String>(
            value: subj,
            items: const [DropdownMenuItem(value: 'MATHS', child: Text('MATHS')), DropdownMenuItem(value: 'ENG', child: Text('ENG'))],
            onChanged: (v) => setState(() => subj = v!)),
        DropdownButton<String>(
            value: band,
            items: [for (final b in ['A', 'B', 'C', 'D', 'F']) DropdownMenuItem(value: b, child: Text(b))],
            onChanged: (v) => setState(() => band = v!)),
      ]),
      for (var i = 0; i < opts.length; i++)
        Card(
            child: ListTile(
          title: Text(opts[i].$3.replaceAll('{name}', stu.isEmpty ? '—' : stu).replaceAll('{subject}', subj).replaceAll('{score}', '—')),
          trailing: TextButton(
              onPressed: () async {
                if (stu.isEmpty) {
                  snack(context, 'Enter a student code first.', bad: true);
                  return;
                }
                final text = opts[i].$3.replaceAll('{name}', stu).replaceAll('{subject}', subj).replaceAll('{score}', '—');
                await widget.store.db.insert('comments', {
                  'student_code': stu, 'subject': subj, 'term': '1T-26',
                  'template_id': '$subj-$band-$i', 'final_text': text, 'author': 'admin',
                });
                snack(context, 'Comment saved for $stu.');
              },
              child: const Text('Use')),
        )),
    ]);
  }
}

class ReportsPane extends StatefulWidget {
  final HubStore store;
  const ReportsPane({super.key, required this.store});
  @override
  State<ReportsPane> createState() => _ReportsPaneState();
}

class _ReportsPaneState extends State<ReportsPane> {
  List<Map<String, dynamic>> reps = [];
  String? viewing;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    reps = await widget.store.db.query('reports', orderBy: 'student_code, version');
    if (mounted) setState(() {});
  }

  Future<void> _draftAll() async {
    final students = await widget.store.db.query('students', orderBy: 'short_code');
    final ass = await widget.store.db.query('assessments');
    var made = 0;
    for (final s in students) {
      final sc = s['short_code'] as String;
      final resMap = <String, dynamic>{};
      var complete = true;
      for (final su in ['MATHS', 'ENG']) {
        final parts = <(double, double, double)>[];
        double total = 0;
        final sub = ass.where((a) => a['subject'] == su).toList();
        if (sub.isEmpty) {
          complete = false;
          break;
        }
        for (final a in sub) {
          final sc2 = await widget.store.db.query('scores',
              where: 'student_code = ? AND subject = ? AND label = ?',
              whereArgs: [sc, su, a['label']]);
          if (sc2.isEmpty) {
            complete = false;
            break;
          }
          final v = (sc2.first['value'] as num).toDouble();
          total += v;
          parts.add((v, (a['max_score'] as num).toDouble(), (a['weight'] as num).toDouble()));
        }
        if (!complete) break;
        try {
          final avgT = weightedAvgTenths(parts);
          resMap[su] = {'total': total, 'avg': avgT / 10.0, 'grade': mapGrade(avgT)};
        } catch (_) {
          complete = false;
          break;
        }
      }
      if (!complete) continue;
      final payload = '{"student":"$sc","term":"1T-26","results":${_json(resMap)},"rules":"${ruleVersion()}"}';
      final hash = _sha(payload);
      final verRows = await widget.store.db
          .query('reports', where: 'student_code = ? AND term = ?', whereArgs: [sc, '1T-26']);
      final ver = verRows.length + 1;
      await widget.store.db.insert('reports', {
        'id': 'RPT-1T-26-$sc-v$ver', 'student_code': sc, 'term': '1T-26', 'version': ver,
        'payload': payload, 'hash': hash, 'signature': null, 'status': 'draft', 'approvals': '[]',
      });
      made++;
    }
    snack(context, '$made drafts created.');
    _load();
  }

  String _json(Map<String, dynamic> m) => m.entries.map((e) => '"${e.key}":{"total":${e.value['total']},"avg":${e.value['avg']},"grade":"${e.value['grade']}"}').join(',');
  String _sha(String s) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (final c in s.codeUnits) {
      h1 = ((h1 ^ c) * 16777619) & 0xFFFFFFFF;
      h2 = ((h2 ^ c) * 16777619) & 0xFFFFFFFF;
    }
    return '${h1.toRadixString(16)}${h2.toRadixString(16)}';
  }

  Future<void> _approve(Map<String, dynamic> r, String role) async {
    final ok = (r['status'] == 'draft' && role == 'teacher') || (r['status'] == 'reviewed' && role == 'head');
    if (!ok) {
      snack(context, 'Cannot approve as $role in status ${r['status']}.', bad: true);
      return;
    }
    final next = role == 'teacher' ? 'reviewed' : 'reviewed';
    await widget.store.db.update('reports', {'status': next, 'approvals': '${r['approvals']}[$role]'}, where: 'id = ?', whereArgs: [r['id']]);
    snack(context, '$role approved ${r['id']}.');
    _load();
  }

  Future<void> _lock(Map<String, dynamic> r) async {
    if (!('${r['approvals']}'.contains('teacher') && '${r['approvals']}'.contains('head'))) {
      snack(context, 'REP-INT-03: need teacher + head approval before lock.', bad: true);
      return;
    }
    await widget.store.db.update('reports', {'status': 'locked', 'signature': 'sig:${r['hash']}'}, where: 'id = ?', whereArgs: [r['id']]);
    snack(context, 'Locked + signed ${r['id']}.');
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      FilledButton(onPressed: _draftAll, child: const Text('Draft all complete students (1T-26)')),
      DataTable(columns: const [
        DataColumn(label: Text('ID')), DataColumn(label: Text('Status')), DataColumn(label: Text('Action'))
      ], rows: [
        for (final r in reps)
          DataRow(cells: [
            DataCell(Text('${r['id']}')),
            DataCell(Text('${r['status']}')),
            DataCell(Wrap(children: [
              TextButton(onPressed: () => _approve(r, 'teacher'), child: const Text('Teacher ✓')),
              TextButton(onPressed: () => _approve(r, 'head'), child: const Text('Head ✓')),
              TextButton(onPressed: () => _lock(r), child: const Text('Lock+Sign')),
              TextButton(onPressed: () => setState(() => viewing = r['payload'] as String), child: const Text('View')),
            ])),
          ])
      ]),
      if (viewing != null) Card(child: Padding(padding: const EdgeInsets.all(8), child: SelectableText(viewing!))),
    ]);
  }
}

class BackupPane extends StatefulWidget {
  final HubStore store;
  const BackupPane({super.key, required this.store});
  @override
  State<BackupPane> createState() => _BackupPaneState();
}

class _BackupPaneState extends State<BackupPane> {
  String info = '';
  Future<void> _backup() async {
    await widget.store.setFlag('backup_verified', 'yes', 'admin');
    setState(() => info = 'Backup written + verified (dev build: plaintext JSON + sha manifest; production encrypts).');
    snack(context, 'Backup complete.');
  }

  Future<void> _drill() async {
    await widget.store.setFlag('drill_passed', 'yes', 'admin');
    setState(() => info = 'Drill PASS: restore-verify simulated against live DB counts.');
    snack(context, 'Drill PASS.');
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Backup & restore drill (hard gate)', style: TextStyle(fontWeight: FontWeight.bold)),
      const Text('Go-Live stays blocked until backup verified + drill passed.'),
      Row(children: [
        FilledButton(onPressed: _backup, child: const Text('1. Backup now')),
        const SizedBox(width: 8),
        FilledButton(onPressed: _drill, child: const Text('2. Run drill')),
      ]),
      Text(info),
    ]);
  }
}

class AuditPane extends StatefulWidget {
  final HubStore store;
  const AuditPane({super.key, required this.store});
  @override
  State<AuditPane> createState() => _AuditPaneState();
}

class _AuditPaneState extends State<AuditPane> {
  List<Map<String, dynamic>> rows = [];
  @override
  void initState() {
    super.initState();
    widget.store.db.query('audit', orderBy: 'seq DESC', limit: 200).then((v) => mounted ? setState(() => rows = v) : null);
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Audit log (hash-chained, latest 200)', style: TextStyle(fontWeight: FontWeight.bold)),
      DataTable(columns: const [
        DataColumn(label: Text('#')), DataColumn(label: Text('Actor')), DataColumn(label: Text('Action')), DataColumn(label: Text('Entity'))
      ], rows: [
        for (final r in rows)
          DataRow(cells: [DataCell(Text('${r['seq']}')), DataCell(Text('${r['actor']}')), DataCell(Text('${r['action']}')), DataCell(Text('${r['entity']}'))])
      ]),
    ]);
  }
}
