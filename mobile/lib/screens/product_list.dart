import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../widgets/common.dart';

/// Which products a list shows: a category, a collection, a search or a sort.
class Listing {
  const Listing({required this.title, this.category, this.collection, this.q, this.sort});
  final String title;
  final String? category;
  final String? collection;
  final String? q;
  final String? sort;
}

/// The filters a customer has chosen.
class Filters {
  Set<String> textures = {};
  Set<String> origins = {};
  Set<String> laceTypes = {};
  Set<String> colours = {};
  Set<int> lengths = {};
  Set<int> densities = {};
  bool inStock = false;

  int get count => textures.length + origins.length + laceTypes.length + colours.length + lengths.length + densities.length + (inStock ? 1 : 0);

  Filters copy() => Filters()
    ..textures = {...textures}
    ..origins = {...origins}
    ..laceTypes = {...laceTypes}
    ..colours = {...colours}
    ..lengths = {...lengths}
    ..densities = {...densities}
    ..inStock = inStock;

  Map<String, String?> toQuery() => {
        'texture': textures.isEmpty ? null : textures.join(','),
        'origin': origins.isEmpty ? null : origins.join(','),
        'lace_type': laceTypes.isEmpty ? null : laceTypes.join(','),
        'colour': colours.isEmpty ? null : colours.join(','),
        'length': lengths.isEmpty ? null : lengths.join(','),
        'density': densities.isEmpty ? null : densities.join(','),
        'in_stock': inStock ? '1' : null,
      };
}

const sorts = <String, String>{
  'newest': 'Newest',
  'best_selling': 'Best-selling',
  'price_low': 'Price: low to high',
  'price_high': 'Price: high to low',
  'name': 'Name',
};

/// A list of products that loads more as you scroll, with filters and sorting.
class ProductListScreen extends StatefulWidget {
  const ProductListScreen({super.key, required this.listing});
  final Listing listing;

  @override
  State<ProductListScreen> createState() => _ProductListScreenState();
}

class _ProductListScreenState extends State<ProductListScreen> {
  final _products = <ProductSummary>[];
  final _scroll = ScrollController();
  Filters _filters = Filters();
  late String? _sort = widget.listing.sort;
  String? _cursor;
  int _total = 0;
  bool _loading = false;
  bool _done = false;
  Object? _error;
  String? _corrected;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600) _more();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() {
      _products.clear();
      _cursor = null;
      _done = false;
      _error = null;
    });
    await _more();
  }

  Future<void> _more() async {
    if (_loading || _done) return;
    setState(() => _loading = true);
    final l = widget.listing;
    try {
      final r = await AppScope.read(context).api.get('/v1/catalog/products', {
        'category': l.category,
        'collection': l.collection,
        'q': l.q,
        'sort': _sort,
        'cursor': _cursor,
        'currency': AppScope.read(context).currency,
        ..._filters.toQuery(),
      });
      final page = ProductPage(r);
      setState(() {
        _products.addAll(page.products);
        _cursor = page.nextCursor;
        _done = page.nextCursor == null;
        _total = page.total;
        _corrected = page.corrected;
      });
    } on ApiError catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openFilters() async {
    final chosen = await showModalBottomSheet<Filters>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => FilterSheet(filters: _filters.copy(), category: widget.listing.category),
    );
    if (chosen != null) {
      _filters = chosen;
      _reload();
    }
  }

  Future<void> _openSort() async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Sort by', style: Type.h2)),
          for (final e in sorts.entries)
            ListTile(
              title: Text(e.value, style: Type.body),
              trailing: (_sort ?? 'newest') == e.key ? const Icon(Icons.check, color: Brand.gold) : null,
              onTap: () => Navigator.pop(context, e.key),
            ),
        ]),
      ),
    );
    if (chosen != null && chosen != _sort) {
      _sort = chosen;
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.listing.title.isEmpty ? 'Products' : widget.listing.title[0].toUpperCase() + widget.listing.title.substring(1);
    Widget body;
    if (_error != null && _products.isEmpty) {
      body = StateMessage.error(_error!, _reload);
    } else if (_products.isEmpty && _loading) {
      body = const Loading();
    } else if (_products.isEmpty) {
      body = StateMessage(
        title: widget.listing.q != null ? 'No results for "${widget.listing.q}"' : 'Nothing matches',
        body: _filters.count > 0 ? 'Try removing a filter.' : 'Try another word, or browse the shop.',
        action: _filters.count > 0 ? 'Clear filters' : null,
        onAction: () {
          _filters = Filters();
          _reload();
        },
      );
    } else {
      final width = MediaQuery.sizeOf(context).width;
      final columns = width >= 900 ? 4 : (width >= 600 ? 3 : 2);
      body = RefreshIndicator(
        onRefresh: _reload,
        child: CustomScrollView(controller: _scroll, slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 8),
            sliver: SliverToBoxAdapter(
              child: Text(
                _corrected != null ? 'Showing results for "$_corrected" · $_total ${_total == 1 ? 'product' : 'products'}' : '$_total ${_total == 1 ? 'product' : 'products'}',
                style: Type.small,
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: Brand.gutter),
            sliver: SliverGrid(
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: 20, crossAxisSpacing: 12, childAspectRatio: 0.52),
              delegate: SliverChildBuilderDelegate(
                (_, i) => ProductCard(product: _products[i], onTap: () => Navigator.of(context).pushNamed('/product', arguments: _products[i].slug)),
                childCount: _products.length,
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: _loading
                  ? const Loading()
                  : _error != null
                      ? Center(child: TextButton(onPressed: _more, child: const Text('Could not load more. Try again')))
                      : _done
                          ? Text("You've seen all $_total", textAlign: TextAlign.center, style: Type.small)
                          : const SizedBox.shrink(),
            ),
          ),
        ]),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 12),
          child: Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: _openFilters, icon: const Icon(Icons.tune), label: Text(_filters.count > 0 ? 'Filter (${_filters.count})' : 'Filter'))),
            const SizedBox(width: 12),
            Expanded(child: OutlinedButton.icon(onPressed: _openSort, icon: const Icon(Icons.swap_vert), label: Text(sorts[_sort ?? 'newest'] ?? 'Sort', overflow: TextOverflow.ellipsis))),
          ]),
        ),
        Expanded(child: body),
      ]),
    );
  }
}

/// The filter sheet: texture, length, density, lace, colour, origin, in stock.
class FilterSheet extends StatefulWidget {
  const FilterSheet({super.key, required this.filters, this.category});
  final Filters filters;
  final String? category;

  @override
  State<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<FilterSheet> {
  late final Filters f = widget.filters;
  Future<Json>? _options;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final state = AppScope.read(context);
    _options ??= state.api.get('/v1/catalog/filters', {'category': widget.category, 'currency': state.currency});
  }

  Widget _group<T>(String title, List<T> values, Set<T> chosen, String Function(T) label) {
    if (values.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Semantics(header: true, child: Text(title, style: Type.strong)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final v in values)
            FilterChip(
              label: Text(label(v)),
              selected: chosen.contains(v),
              labelStyle: Type.body.copyWith(color: chosen.contains(v) ? Brand.noir : Brand.ivory),
              onSelected: (on) => setState(() => on ? chosen.add(v) : chosen.remove(v)),
            ),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Json>(
      future: _options,
      builder: (context, snap) {
        if (snap.hasError) return SizedBox(height: 300, child: StateMessage.error(snap.error!, () => setState(() => _options = AppScope.read(context).api.get('/v1/catalog/filters', {'category': widget.category, 'currency': AppScope.read(context).currency}))));
        if (!snap.hasData) return const SizedBox(height: 300, child: Loading());
        final o = snap.data!;
        List<String> strs(String k) => ((o[k] as List?) ?? const []).map((e) => '$e').toList();
        List<int> ints(String k) => ((o[k] as List?) ?? const []).whereType<num>().map((n) => n.toInt()).toList();
        final minP = (o['minPriceMinor'] as num?)?.toInt();
        final maxP = (o['maxPriceMinor'] as num?)?.toInt();
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.85,
          maxChildSize: 0.95,
          builder: (context, scroll) => Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 8),
              child: Row(children: [
                const Expanded(child: Text('Filter', style: Type.h2)),
                TextButton(onPressed: () => Navigator.pop(context, Filters()), child: const Text('Clear all')),
              ]),
            ),
            Expanded(
              child: ListView(controller: scroll, padding: const EdgeInsets.symmetric(horizontal: 20), children: [
                if (minP != null && maxP != null) Padding(padding: const EdgeInsets.only(bottom: 16), child: Text('Prices from ${money(minP, '${o['currency']}')} to ${money(maxP, '${o['currency']}')}', style: Type.small)),
                _group<String>('Texture', strs('textures'), f.textures, (v) => v),
                _group<int>('Length', ints('lengths'), f.lengths, (v) => '$v"'),
                _group<int>('Density', ints('densities'), f.densities, (v) => '$v%'),
                _group<String>('Lace', strs('laceTypes'), f.laceTypes, (v) => v),
                _group<String>('Colour', strs('colours'), f.colours, (v) => v),
                _group<String>('Hair origin', strs('origins'), f.origins, (v) => v),
                SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('In stock only', style: Type.body), value: f.inStock, onChanged: (v) => setState(() => f.inStock = v)),
                const SizedBox(height: 16),
              ]),
            ),
            SafeArea(
              top: false,
              child: Padding(padding: const EdgeInsets.all(16), child: BusyButton(label: 'Show results', onPressed: () => Navigator.pop(context, f))),
            ),
          ]),
        );
      },
    );
  }
}
