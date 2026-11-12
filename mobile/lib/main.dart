import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api/client.dart';
import 'push.dart';
import 'routes.dart';
import 'screens/onboarding.dart';
import 'screens/shell.dart';
import 'state/app_state.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent, systemNavigationBarColor: Brand.noir));
  final state = AppState(ApiClient());
  runApp(HairByDemjApp(state: state));
  await state.start();
  await Push.instance.start(state);
}

class HairByDemjApp extends StatelessWidget {
  const HairByDemjApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'hairbydemj',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        navigatorKey: Push.navigatorKey,
        onGenerateRoute: onGenerateRoute,
        home: const _Start(),
      ),
    );
  }
}

/// The splash while the app gets ready, then onboarding once, then the shop.
class _Start extends StatelessWidget {
  const _Start();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    if (!state.ready) return const Splash();
    if (!state.onboarded) return const Onboarding();
    return const Shell();
  }
}
