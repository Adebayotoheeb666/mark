/// Agent Mark Hub console shell: NavigationRail + 8 sections.
import 'package:flutter/material.dart';
import 'screens.dart';
import 'store.dart';

void main() => runApp(const HubApp());

class HubApp extends StatelessWidget {
  const HubApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Agent Mark Hub',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF0B6E4F), useMaterial3: true),
      home: const Shell(),
    );
  }
}

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int index = 0;
  HubStore? store;
  String? error;

  @override
  void initState() {
    super.initState();
    HubStore.open().then((s) => setState(() => store = s)).catchError((e) {
      setState(() => error = '$e');
      return HubStore.open(); // satisfy future type; error screen stays
    });
  }

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Scaffold(body: Center(child: Text('Startup failed:\n$error')));
    }
    if (store == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final pages = [
      DashboardPane(store: store!), StudentsPane(store: store!), ScoresPane(store: store!),
      FlagsPane(store: store!), CommentsPane(store: store!), ReportsPane(store: store!),
      BackupPane(store: store!), AuditPane(store: store!),
    ];
    const labels = ['Dashboard', 'Students', 'Scores', 'Flags', 'Comments', 'Reports', 'Backup', 'Audit'];
    const icons = [
      Icons.dashboard, Icons.people, Icons.edit_note, Icons.flag,
      Icons.comment, Icons.picture_as_pdf, Icons.backup, Icons.history
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Agent Mark Hub · local-first')),
      body: Row(children: [
        NavigationRail(
          selectedIndex: index,
          onDestinationSelected: (i) => setState(() => index = i),
          labelType: NavigationRailLabelType.all,
          destinations: [for (var i = 0; i < labels.length; i++) NavigationRailDestination(icon: Icon(icons[i]), label: Text(labels[i]))],
        ),
        const VerticalDivider(width: 1),
        Expanded(child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: pages[index])),
      ]),
    );
  }
}

void snack(BuildContext context, String msg, {bool bad = false}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(msg),
    backgroundColor: bad ? Colors.red.shade800 : null,
    duration: const Duration(seconds: 4),
  ));
}
