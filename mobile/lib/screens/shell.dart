import 'package:material_ui/material_ui.dart';

import '../routes.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'account.dart';
import 'cart.dart';
import 'home.dart';
import 'shop.dart';
import 'try_on.dart';

/// The five tabs: Home, Shop, Try on, Bag, Account.
class Shell extends StatefulWidget {
  const Shell({super.key});

  /// Lets other screens switch tab (for example "Go to bag").
  static void goTo(BuildContext context, int tab) => context.findAncestorStateOfType<_ShellState>()?.select(tab);

  static const home = 0;
  static const shop = 1;
  static const tryOn = 2;
  static const bag = 3;
  static const account = 4;

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _tab = 0;
  final _keys = List.generate(5, (_) => GlobalKey<NavigatorState>());

  void select(int tab) {
    if (tab == _tab) {
      // Tapping the open tab goes back to its first screen.
      _keys[tab].currentState?.popUntil((r) => r.isFirst);
    }
    setState(() => _tab = tab);
  }

  @override
  Widget build(BuildContext context) {
    final count = AppScope.of(context).cart.itemCount;
    const roots = <Widget>[HomeScreen(), ShopScreen(), TryOnScreen(), CartScreen(), AccountScreen()];
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final nav = _keys[_tab].currentState;
        if (nav != null && nav.canPop()) {
          nav.pop();
        } else if (_tab != 0) {
          setState(() => _tab = 0);
        }
      },
      child: Scaffold(
        body: IndexedStack(
          index: _tab,
          children: [
            for (var i = 0; i < 5; i++)
              Navigator(
                key: _keys[i],
                onGenerateRoute: (settings) => settings.name == '/' ? MaterialPageRoute<dynamic>(builder: (_) => roots[i], settings: settings) : onGenerateRoute(settings),
              ),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: select,
          destinations: [
            const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
            const NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Shop'),
            const NavigationDestination(icon: Icon(Icons.auto_awesome_outlined), selectedIcon: Icon(Icons.auto_awesome), label: 'Try on'),
            NavigationDestination(
              icon: Badge(isLabelVisible: count > 0, label: Text('$count'), backgroundColor: Brand.gold, textColor: Brand.noir, child: const Icon(Icons.shopping_bag_outlined)),
              selectedIcon: Badge(isLabelVisible: count > 0, label: Text('$count'), backgroundColor: Brand.gold, textColor: Brand.noir, child: const Icon(Icons.shopping_bag)),
              label: 'Bag',
              tooltip: count > 0 ? 'Bag, $count items' : 'Bag',
            ),
            const NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Account'),
          ],
        ),
      ),
    );
  }
}
