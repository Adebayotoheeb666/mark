/// Deterministic engine port (mirrors engine/calc.py + validate.py).
/// Same inputs + same pack version -> same outputs. No I/O, no network.
import 'dart:math';

const engineVersion = '0.3.0';
const packId = 'ng-secondary@1.4.0';
const templateVer = 'ng-secondary-rep@1.4.0';
String ruleVersion() => 'engine $engineVersion + $packId';

int roundHalfUp(double x) => (x + 0.5).floor();

/// items: (value, maxScore, weightPct). Returns average in tenths (685 = 68.5%).
int weightedAvgTenths(List<(double, double, double)> items) {
  if (items.isEmpty) throw const FormatException('VAL-MISS-01: no assessments provided');
  var wSum = 0.0, acc = 0.0;
  for (final (v, m, w) in items) {
    if (m <= 0) throw const FormatException('VAL-TYPE-01: max_score must be > 0');
    if (v.isNaN) throw const FormatException('VAL-MISS-01: missing score');
    if (v < 0 || v > m) throw FormatException('VAL-RANGE-01: $v is outside 0–$m');
    wSum += w;
    acc += v / m * w * 10.0;
  }
  if ((wSum - 100.0).abs() > 1e-9) {
    throw FormatException('VAL-WEIGHT-01: weights sum to $wSum%, must be 100%');
  }
  return roundHalfUp(acc + 1e-9);
}

String mapGrade(int avgTenths) {
  for (final e in [(70, 'A'), (60, 'B'), (50, 'C'), (45, 'D'), (40, 'E')]) {
    if (avgTenths >= e.$1 * 10) return e.$2;
  }
  return 'F';
}

/// Competition rank ("1224"): 1 + count(strictly greater).
List<int> competitionRank(List<double> avgs) =>
    avgs.map((a) => 1 + avgs.where((x) => x > a).length).toList();

String? checkRange(double? value, double maxScore) {
  if (value == null || value.isNaN) return 'VAL-MISS-01: score is missing';
  if (value < 0 || value > maxScore) return 'VAL-RANGE-01: $value is outside 0–$maxScore';
  return null;
}

String? checkJump(double current, double? priorMean, {double threshold = 25}) {
  if (priorMean == null) return null;
  final d = current - priorMean;
  if (d.abs() >= threshold) {
    return 'VAL-JUMP-01: moved ${d > 0 ? 'up' : 'down'} from ${priorMean.toStringAsFixed(1)} '
        'to ${current.toStringAsFixed(1)} — please confirm.';
  }
  return null;
}

String? checkOutlier(double avg, List<double> peers, {double sd = 3}) {
  if (peers.length < 4) return null;
  final mean = peers.reduce((a, b) => a + b) / peers.length;
  final variance = peers.map((p) => (p - mean) * (p - mean)).reduce((a, b) => a + b) / peers.length;
  final s = sqrt(variance);
  if (s == 0) return null;
  final z = (avg - mean) / s;
  if (z.abs() > sd) {
    return 'VAL-OUTLIER-01: ${avg.toStringAsFixed(1)} is ${z.abs().toStringAsFixed(1)} SD from '
        'class average ${mean.toStringAsFixed(1)} — second look only, never auto-changed.';
  }
  return null;
}

String explain(double total, double avg, String grade) =>
    'Total ${total.toStringAsFixed(0)}, average ${avg.toStringAsFixed(1)}% '
    '(CALC-WAVG-01, CALC-ROUND-01) → grade $grade (CALC-GRADE-01) under ${ruleVersion()}.';
