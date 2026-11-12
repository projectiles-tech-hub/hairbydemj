import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'product_list.dart';

/// Home: the banner, categories, best-sellers, new arrivals and looks, in the
/// order staff set in the admin.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeData {
  _HomeData(this.sections, this.categories, this.best, this.fresh, this.looks);
  final List<Json> sections;
  final List<Category> categories;
  final List<ProductSummary> best;
  final List<ProductSummary> fresh;
  final List<Json> looks;
}

class _HomeScreenState extends State<HomeScreen> {
  Future<_HomeData>? _load;
  String? _currency;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final currency = AppScope.of(context).currency;
    if (currency != _currency) {
      _currency = currency;
      _load = _fetch();
    }
  }

  Future<_HomeData> _fetch() async {
    final api = AppScope.read(context).api;
    final c = _currency;
    final results = await Future.wait([
      api.get('/v1/catalog/home'),
      api.get('/v1/catalog/categories'),
      api.get('/v1/catalog/products', {'sort': 'best_selling', 'limit': '4', 'currency': c}),
      api.get('/v1/catalog/products', {'sort': 'newest', 'limit': '4', 'currency': c}),
      api.get('/v1/catalog/collections', {'looks': '1'}),
    ]);
    List<Json> list(Json j, String key) => ((j[key] as List?) ?? const []).whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
    return _HomeData(
      list(results[0], 'sections'),
      list(results[1], 'categories').map(Category.new).toList(),
      ProductPage(results[2]).products,
      ProductPage(results[3]).products,
      list(results[4], 'collections'),
    );
  }

  Future<void> _refresh() async {
    setState(() => _load = _fetch());
    await _load;
  }

  void _openLink(String link) {
    // Staff write website addresses (/c/wigs/); the app opens the same list.
    final m = RegExp(r'^/c/([a-z0-9-]+)/?').firstMatch(link);
    if (m != null) {
      Navigator.of(context).pushNamed('/list', arguments: Listing(title: m.group(1)!.replaceAll('-', ' '), category: m.group(1)));
    } else if (link.startsWith('/products/')) {
      Navigator.of(context).pushNamed('/product', arguments: link.split('/')[2]);
    } else {
      Navigator.of(context).pushNamed('/list', arguments: const Listing(title: 'New arrivals', sort: 'newest'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Semantics(label: 'hairbydemj', header: true, child: Image.asset('assets/brand/wordmark.png', height: 26, excludeFromSemantics: true)),
        actions: [
          IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: () => Navigator.of(context).pushNamed('/search')),
          IconButton(tooltip: 'Wishlist', icon: const Icon(Icons.favorite_border), onPressed: () => Navigator.of(context).pushNamed(state.signedIn ? '/wishlist' : '/sign-in')),
          IconButton(
            tooltip: state.unread > 0 ? 'Notifications, ${state.unread} new' : 'Notifications',
            icon: Badge(isLabelVisible: state.unread > 0, backgroundColor: Brand.gold, child: const Icon(Icons.notifications_none)),
            onPressed: () => Navigator.of(context).pushNamed(state.signedIn ? '/notifications' : '/sign-in'),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: FutureBuilder<_HomeData>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, _refresh);
          if (!snap.hasData) return const Loading();
          final d = snap.data!;
          final parts = <Widget>[];
          for (final s in d.sections) {
            final settings = (s['settings'] as Map?)?.cast<String, dynamic>() ?? const {};
            String word(String key, String fallback) => (settings[key] is String && (settings[key] as String).trim().isNotEmpty) ? (settings[key] as String).trim() : fallback;
            switch (s['kind']) {
              case 'hero':
                parts.add(_Banner(
                  headline: word('headline', 'Hair that moves the way you do'),
                  sentence: word('sentence', 'Human hair wigs, bundles and closures. Sent from Benin City to your door, anywhere in the world.'),
                  button: word('buttonLabel', 'Shop new arrivals'),
                  onTap: () => _openLink(word('buttonLink', '')),
                ));
              case 'collections':
                if (d.categories.isNotEmpty) {
                  parts.add(Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final c in d.categories)
                        ActionChip(
                          label: Text(c.name),
                          onPressed: () => Navigator.of(context).pushNamed('/list', arguments: Listing(title: c.name, category: c.slug)),
                        ),
                    ]),
                  ));
                }
              case 'best_sellers':
                if (d.best.isNotEmpty) {
                  parts
                    ..add(SectionHead(word('title', 'Best-sellers'), action: 'See all', onAction: () => Navigator.of(context).pushNamed('/list', arguments: const Listing(title: 'Best-sellers', sort: 'best_selling'))))
                    ..add(ProductGrid(products: d.best, onTap: (p) => Navigator.of(context).pushNamed('/product', arguments: p.slug)));
                }
              case 'new_arrivals':
                if (d.fresh.isNotEmpty) {
                  parts
                    ..add(SectionHead(word('title', 'New arrivals'), action: 'See all', onAction: () => Navigator.of(context).pushNamed('/list', arguments: const Listing(title: 'New arrivals', sort: 'newest'))))
                    ..add(ProductGrid(products: d.fresh, onTap: (p) => Navigator.of(context).pushNamed('/product', arguments: p.slug)));
                }
              case 'shop_the_look':
                if (d.looks.isNotEmpty) {
                  parts.add(SectionHead(word('title', 'Shop the look')));
                  for (final l in d.looks.take(3)) {
                    parts.add(Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Material(
                        color: Brand.espresso,
                        borderRadius: BorderRadius.circular(Brand.radiusCard),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          title: Text('${l['name']}', style: Type.strong),
                          subtitle: '${l['description'] ?? ''}'.isEmpty ? null : Text('${l['description']}', style: Type.small),
                          trailing: const Icon(Icons.chevron_right, color: Brand.ivory),
                          onTap: () => Navigator.of(context).pushNamed('/list', arguments: Listing(title: '${l['name']}', collection: '${l['slug']}')),
                        ),
                      ),
                    ));
                  }
                }
            }
          }
          if (d.best.isEmpty && d.fresh.isEmpty) {
            parts.add(const Padding(padding: EdgeInsets.only(top: 32), child: StateMessage(title: 'Coming soon', body: 'New hair is on its way. Please check back soon.')));
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(padding: const EdgeInsets.fromLTRB(Brand.gutter, 8, Brand.gutter, 32), children: parts),
          );
        },
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.headline, required this.sentence, required this.button, required this.onTap});

  final String headline;
  final String sentence;
  final String button;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Brand.espresso, borderRadius: BorderRadius.circular(Brand.radiusCard)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Semantics(header: true, child: Text(headline, style: Type.display.copyWith(fontSize: 32))),
        const SizedBox(height: 8),
        Text(sentence, style: Type.body),
        const SizedBox(height: 16),
        BusyButton(label: button, onPressed: onTap, expand: false),
      ]),
    );
  }
}
