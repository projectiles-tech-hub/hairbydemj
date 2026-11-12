import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../config.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// A product: photos, choosing length, density, lace and colour, the price and
/// exact stock for that choice, and "Add to bag".
class ProductScreen extends StatefulWidget {
  const ProductScreen({super.key, required this.slug});
  final String slug;

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  Future<Product>? _load;
  final Map<String, String> _chosen = {};
  bool _adding = false;
  int _photo = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= _fetch();
  }

  Future<Product> _fetch() async {
    final state = AppScope.read(context);
    final p = Product((await state.api.get('/v1/catalog/products/${Uri.encodeComponent(widget.slug)}', {'currency': state.currency}))['product'] as Json);
    // Start on the first variant that can be bought.
    final first = p.variants.firstWhere((v) => v.available > 0, orElse: () => p.variants.isEmpty ? Variant(const {}) : p.variants.first);
    if (p.variants.isNotEmpty) {
      for (final o in _options(p)) {
        final value = o.of(first);
        if (value != null) _chosen[o.key] = value;
      }
    }
    return p;
  }

  List<_Option> _options(Product p) {
    final all = <_Option>[
      _Option('length', 'Length', (v) => v.lengthInches == null ? null : '${v.lengthInches}"'),
      _Option('density', 'Density', (v) => v.densityPercent == null ? null : '${v.densityPercent}%'),
      _Option('lace', 'Lace', (v) => v.laceType),
      _Option('colour', 'Colour', (v) => v.colour),
      _Option('cap', 'Cap size', (v) => v.capSize),
    ];
    return all.where((o) => p.variants.map(o.of).whereType<String>().toSet().isNotEmpty).toList();
  }

  Variant? _variant(Product p) {
    final options = _options(p);
    for (final v in p.variants) {
      if (options.every((o) => o.of(v) == _chosen[o.key])) return v;
    }
    return null;
  }

  Future<void> _add(Variant v) async {
    setState(() => _adding = true);
    try {
      await AppScope.read(context).addToCart(v.id, 1);
      if (!mounted) return;
      showMessage(context, 'Added to your bag.', action: SnackBarAction(label: 'View bag', textColor: Brand.gold, onPressed: () => Shell.goTo(context, Shell.bag)));
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return FutureBuilder<Product>(
      future: _load,
      builder: (context, snap) {
        if (snap.hasError) {
          final notFound = snap.error is ApiError && (snap.error as ApiError).status == 404;
          return Scaffold(
            appBar: AppBar(),
            body: notFound ? const StateMessage(title: 'We could not find that', body: 'It may have sold out or been removed.') : StateMessage.error(snap.error!, () => setState(() => _load = _fetch())),
          );
        }
        if (!snap.hasData) return Scaffold(appBar: AppBar(), body: const Loading());
        final p = snap.data!;
        final v = _variant(p);
        final saved = state.wishlist.contains(p.id);
        final options = _options(p);
        final photos = p.media.where((m) => !m.isVideo).toList();
        return Scaffold(
          appBar: AppBar(actions: [
            IconButton(
              tooltip: 'Copy link',
              icon: const Icon(Icons.share_outlined),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: '${AppConfig.siteBase}/products/${p.slug}/'));
                showMessage(context, 'Link copied.');
              },
            ),
            IconButton(tooltip: saved ? 'Remove from wishlist' : 'Save to wishlist', icon: Icon(saved ? Icons.favorite : Icons.favorite_border), onPressed: () => saveToWishlist(context, p.id)),
          ]),
          body: ListView(padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 32), children: [
            AspectRatio(
              aspectRatio: 4 / 5,
              child: photos.isEmpty
                  ? Photo(picture: null, label: p.name)
                  : Stack(children: [
                      PageView.builder(
                        itemCount: photos.length,
                        onPageChanged: (i) => setState(() => _photo = i),
                        itemBuilder: (_, i) => Photo(picture: photos[i].raw, want: 1080),
                      ),
                      if (photos.length > 1)
                        Positioned(
                          bottom: 12,
                          right: 12,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(color: Brand.noir.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(999)),
                            child: Text('${_photo + 1} of ${photos.length}', style: Type.small.copyWith(color: Brand.ivory)),
                          ),
                        ),
                    ]),
            ),
            const SizedBox(height: 16),
            Semantics(header: true, child: Text(p.name, style: Type.h1)),
            const SizedBox(height: 6),
            Text(
              v == null ? 'Not available in this choice' : (v.available <= 0 ? 'Sold out' : (v.lowStock ? 'Only ${v.available} left' : '${v.available} in stock')),
              style: Type.small.copyWith(color: v != null && v.available > 0 && !v.lowStock ? Brand.textMuted : Brand.blush),
            ),
            const SizedBox(height: 16),
            for (final o in options) ...[
              Text(o.label, style: Type.strong),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final value in p.variants.map(o.of).whereType<String>().toSet())
                  ChoiceChip(
                    label: Text(value),
                    selected: _chosen[o.key] == value,
                    labelStyle: Type.body.copyWith(color: _chosen[o.key] == value ? Brand.noir : Brand.ivory),
                    onSelected: (_) => setState(() => _chosen[o.key] = value),
                  ),
              ]),
              const SizedBox(height: 16),
            ],
            if (p.isFinalSale)
              Container(
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Brand.goldSoft, borderRadius: BorderRadius.circular(Brand.radiusControl)),
                child: const Text('Final sale: this can be returned only if we sent the wrong item or it arrived damaged.', style: Type.body),
              ),
            if (p.description.isNotEmpty) ...[const SectionHead('About this hair'), Text(p.description, style: Type.body)],
            if ([p.texture, p.origin, p.grade, p.categoryName].any((x) => x != null && x.isNotEmpty)) ...[
              const SectionHead('Details'),
              for (final (label, value) in [('Texture', p.texture), ('Hair origin', p.origin), ('Grade', p.grade), ('Category', p.categoryName)])
                if (value != null && value.isNotEmpty)
                  Padding(padding: const EdgeInsets.only(bottom: 6), child: Row(children: [SizedBox(width: 120, child: Text(label, style: Type.small)), Expanded(child: Text(value, style: Type.body))])),
            ],
            if (p.careGuide.isNotEmpty) ...[const SectionHead('Care'), Text(p.careGuide, style: Type.body)],
            const SectionHead('Delivery and duties'),
            const Text('Delivery options and prices are shown at checkout. For orders outside Nigeria, import duties and taxes are paid by you to the carrier on delivery.', style: Type.body),
          ]),
          bottomNavigationBar: SafeArea(
            child: Container(
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.line))),
              padding: const EdgeInsets.fromLTRB(Brand.gutter, 12, Brand.gutter, 12),
              child: Row(children: [
                Text(v == null ? '' : money(v.priceMinor, p.currency), style: Type.price.copyWith(fontSize: 22)),
                const SizedBox(width: 12),
                Expanded(child: BusyButton(label: v != null && v.available <= 0 ? 'Sold out' : 'Add to bag', busy: _adding, onPressed: v == null || v.available <= 0 ? null : () => _add(v))),
              ]),
            ),
          ),
        );
      },
    );
  }
}

class _Option {
  _Option(this.key, this.label, this.of);
  final String key;
  final String label;
  final String? Function(Variant) of;
}
