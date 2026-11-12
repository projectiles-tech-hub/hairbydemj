import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'product_list.dart';

/// Shop: every category and the categories inside it.
class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  late Future<List<Category>> _load = _fetch();

  Future<List<Category>> _fetch() async {
    final r = await AppScope.read(context).api.get('/v1/catalog/categories');
    return ((r['categories'] as List?) ?? const []).whereType<Map>().map((m) => Category(m.cast<String, dynamic>())).toList();
  }

  void _open(Category c) => Navigator.of(context).pushNamed('/list', arguments: Listing(title: c.name, category: c.slug));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop'),
        actions: [IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: () => Navigator.of(context).pushNamed('/search'))],
      ),
      body: FutureBuilder<List<Category>>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, () => setState(() => _load = _fetch()));
          if (!snap.hasData) return const Loading();
          final cats = snap.data!;
          if (cats.isEmpty) return const StateMessage(title: 'Nothing here yet', body: 'New hair is on its way. Please check back soon.');
          return ListView(
            padding: const EdgeInsets.symmetric(horizontal: Brand.gutter),
            children: [
              LinkRow('Everything', onTap: () => Navigator.of(context).pushNamed('/list', arguments: const Listing(title: 'Everything'))),
              for (final c in cats) ...[
                LinkRow(c.name, subtitle: '${c.productCount} ${c.productCount == 1 ? 'product' : 'products'}', onTap: () => _open(c)),
                for (final child in c.children)
                  Padding(
                    padding: const EdgeInsets.only(left: 16),
                    child: LinkRow(child.name, subtitle: '${child.productCount} ${child.productCount == 1 ? 'product' : 'products'}', onTap: () => _open(child)),
                  ),
              ],
            ],
          );
        },
      ),
    );
  }
}
