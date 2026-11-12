import 'package:material_ui/material_ui.dart';

import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Shown while the app gets ready.
class Splash extends StatelessWidget {
  const Splash({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Semantics(label: 'hairbydemj', child: Image.asset('assets/brand/wordmark.png', width: 220, excludeFromSemantics: true)),
          const SizedBox(height: 32),
          const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, semanticsLabel: 'Loading')),
        ]),
      ),
    );
  }
}

/// Three slides, the first time the app opens.
class Onboarding extends StatefulWidget {
  const Onboarding({super.key});

  @override
  State<Onboarding> createState() => _OnboardingState();
}

class _OnboardingState extends State<Onboarding> {
  final _pages = PageController();
  int _page = 0;

  static const _slides = [
    (Icons.auto_awesome, 'Hair that moves the way you do', 'Human hair wigs, bundles and closures, chosen by Demj.'),
    (Icons.local_shipping_outlined, 'Delivered anywhere', 'From Benin City to your door, with tracking all the way.'),
    (Icons.straighten, 'Exactly what you want', 'Choose the length, density, lace and colour, and see the exact stock.'),
  ];

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final last = _page == _slides.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(children: [
          Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => AppScope.read(context).finishOnboarding(), child: const Text('Skip'))),
          Expanded(
            child: PageView(
              controller: _pages,
              onPageChanged: (i) => setState(() => _page = i),
              children: [
                for (final (icon, title, body) in _slides)
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(icon, size: 64, color: Brand.gold),
                      const SizedBox(height: 32),
                      Text(title, style: Type.display, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      Text(body, style: Type.body, textAlign: TextAlign.center),
                    ]),
                  ),
              ],
            ),
          ),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 0; i < _slides.length; i++)
              Container(margin: const EdgeInsets.all(4), width: i == _page ? 20 : 8, height: 8, decoration: BoxDecoration(color: i == _page ? Brand.gold : Brand.line, borderRadius: BorderRadius.circular(4))),
          ]),
          Padding(
            padding: const EdgeInsets.all(24),
            child: BusyButton(
              label: last ? 'Start shopping' : 'Next',
              onPressed: () => last ? AppScope.read(context).finishOnboarding() : _pages.nextPage(duration: const Duration(milliseconds: 300), curve: Curves.easeOut),
            ),
          ),
        ]),
      ),
    );
  }
}
