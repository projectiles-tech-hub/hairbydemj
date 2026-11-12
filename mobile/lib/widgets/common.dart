import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';

/// A photo from the shop, or a quiet brown panel while there is none.
class Photo extends StatelessWidget {
  const Photo({super.key, required this.picture, this.aspect = 4 / 5, this.radius = Brand.radiusCard, this.want = 640, this.label});

  final Json? picture;
  final double aspect;
  final double radius;
  final int want;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final url = AppScope.read(context).api.imageUrl(picture, want: want);
    final alt = (picture?['alt'] as String?) ?? label ?? '';
    final empty = Container(color: Brand.surfacePhoto, alignment: Alignment.center, child: const Icon(Icons.image_outlined, color: Brand.line, size: 32));
    return Semantics(
      image: true,
      label: alt,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: AspectRatio(
          aspectRatio: aspect,
          child: url == null
              ? empty
              : Image.network(url, fit: BoxFit.cover, excludeFromSemantics: true, errorBuilder: (_, __, ___) => empty, loadingBuilder: (c, child, p) => p == null ? child : empty),
        ),
      ),
    );
  }
}

/// A gold button that shows it is busy and cannot be pressed twice.
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false, this.outlined = false, this.expand = true});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final bool outlined;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final child = busy
        ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: outlined ? Brand.gold : Brand.noir, semanticsLabel: 'Please wait'))
        : Text(label);
    final button = outlined ? OutlinedButton(onPressed: busy ? null : onPressed, child: child) : FilledButton(onPressed: busy ? null : onPressed, child: child);
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// A heading with an optional "See all" link, as on the home screen.
class SectionHead extends StatelessWidget {
  const SectionHead(this.title, {super.key, this.action, this.onAction});

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 24, bottom: 12),
      child: Row(children: [
        Expanded(child: Semantics(header: true, child: Text(title, style: Type.h2))),
        if (action != null) TextButton(onPressed: onAction, child: Text(action!, style: Type.small.copyWith(color: Brand.ivory))),
      ]),
    );
  }
}

/// A product in a grid: photo, saved heart, name, detail line and price.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, required this.onTap, this.badge});

  final ProductSummary product;
  final VoidCallback onTap;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final saved = state.wishlist.contains(product.id);
    final price = product.priceFromMinor == product.priceToMinor ? money(product.priceFromMinor, product.currency) : 'From ${money(product.priceFromMinor, product.currency)}';
    return Semantics(
      button: true,
      label: '${product.name}, $price${product.inStock ? '' : ', sold out'}',
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Brand.radiusCard),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Stack(children: [
            Photo(picture: product.image, label: product.name),
            if (badge != null || !product.inStock)
              Positioned(
                left: 8,
                top: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: product.inStock ? Brand.goldLight : Brand.surfaceRaised, borderRadius: BorderRadius.circular(999)),
                  child: Text(product.inStock ? badge! : 'Sold out', style: Type.small.copyWith(color: product.inStock ? Brand.noir : Brand.ivory)),
                ),
              ),
            Positioned(
              right: 4,
              top: 4,
              child: IconButton(
                tooltip: saved ? 'Remove from wishlist' : 'Save to wishlist',
                style: IconButton.styleFrom(backgroundColor: Brand.surfaceRaised.withValues(alpha: 0.8)),
                icon: Icon(saved ? Icons.favorite : Icons.favorite_border, color: Brand.ivory, size: 20),
                onPressed: () => saveToWishlist(context, product.id),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          Text(product.name, style: Type.strong, maxLines: 2, overflow: TextOverflow.ellipsis),
          if (product.detail.isNotEmpty) Text(product.detail, style: Type.small, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 2),
          Text(price, style: Type.price.copyWith(fontSize: 18)),
        ]),
      ),
    );
  }
}

/// Saving needs an account: ask to sign in first.
Future<void> saveToWishlist(BuildContext context, int productId) async {
  final state = AppScope.read(context);
  if (!state.signedIn) {
    showMessage(context, 'Sign in to save items to your wishlist.', action: SnackBarAction(label: 'Sign in', textColor: Brand.gold, onPressed: () => Navigator.of(context).pushNamed('/sign-in')));
    return;
  }
  try {
    await state.toggleWishlist(productId);
  } on ApiError catch (e) {
    if (context.mounted) showMessage(context, e.message);
  }
}

/// Two products per row on phones, three or four on tablets.
class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.products, required this.onTap, this.shrinkWrap = true, this.controller, this.footer});

  final List<ProductSummary> products;
  final void Function(ProductSummary) onTap;
  final bool shrinkWrap;
  final ScrollController? controller;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 900 ? 4 : (width >= 600 ? 3 : 2);
    return GridView.builder(
      controller: controller,
      shrinkWrap: shrinkWrap,
      physics: shrinkWrap ? const NeverScrollableScrollPhysics() : null,
      padding: shrinkWrap ? EdgeInsets.zero : const EdgeInsets.all(Brand.gutter),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: 20, crossAxisSpacing: 12, childAspectRatio: 0.52),
      itemCount: products.length,
      itemBuilder: (_, i) => ProductCard(product: products[i], onTap: () => onTap(products[i])),
    );
  }
}

/// A full-screen message: nothing here yet, or something went wrong.
class StateMessage extends StatelessWidget {
  const StateMessage({super.key, required this.title, this.body, this.action, this.onAction, this.icon});

  final String title;
  final String? body;
  final String? action;
  final VoidCallback? onAction;
  final IconData? icon;

  /// For an error from the server, with "Try again".
  factory StateMessage.error(Object error, VoidCallback retry) {
    final e = error is ApiError ? error : null;
    return StateMessage(
      icon: e?.offline == true ? Icons.wifi_off : Icons.error_outline,
      title: e?.offline == true ? 'You are offline' : 'That did not load',
      body: e?.message ?? 'Something went wrong. Please try again.',
      action: 'Try again',
      onAction: retry,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) Icon(icon, size: 40, color: Brand.gold),
          if (icon != null) const SizedBox(height: 16),
          Text(title, style: Type.h2, textAlign: TextAlign.center),
          if (body != null) ...[const SizedBox(height: 8), Text(body!, style: Type.body.copyWith(color: Brand.textMuted), textAlign: TextAlign.center)],
          if (action != null) ...[const SizedBox(height: 24), BusyButton(label: action!, onPressed: onAction, outlined: true, expand: false)],
        ]),
      ),
    );
  }
}

class Loading extends StatelessWidget {
  const Loading({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading'));
}

/// A row in a list that opens another screen.
class LinkRow extends StatelessWidget {
  const LinkRow(this.label, {super.key, required this.onTap, this.trailing, this.subtitle});

  final String label;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      ListTile(
        contentPadding: EdgeInsets.zero,
        minTileHeight: 64,
        title: Text(label, style: Type.body),
        subtitle: subtitle == null ? null : Text(subtitle!, style: Type.small),
        trailing: trailing ?? const Icon(Icons.chevron_right, color: Brand.ivory),
        onTap: onTap,
      ),
      const Divider(),
    ]);
  }
}

/// A brown panel with label and value rows, for totals.
class SummaryPanel extends StatelessWidget {
  const SummaryPanel({super.key, required this.rows, this.total});

  final List<(String, String)> rows;
  final (String, String)? total;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Brand.espresso, borderRadius: BorderRadius.circular(Brand.radiusControl)),
      child: Column(children: [
        for (final (label, value) in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(children: [Expanded(child: Text(label, style: Type.small.copyWith(color: Brand.ivory))), Text(value, style: Type.small.copyWith(color: Brand.ivory))]),
          ),
        if (total != null) ...[
          const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider()),
          Row(children: [Expanded(child: Text(total!.$1, style: Type.strong)), Text(total!.$2, style: Type.strong)]),
        ],
      ]),
    );
  }
}

/// The "− 1 +" control on the bag.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({super.key, required this.value, required this.onChanged, this.max = 99, this.busy = false});

  final int value;
  final int max;
  final bool busy;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      decoration: BoxDecoration(border: Border.all(color: Brand.gold), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(tooltip: 'One fewer', onPressed: busy || value <= 1 ? null : () => onChanged(value - 1), icon: const Icon(Icons.remove, color: Brand.ivory)),
        SizedBox(width: 28, child: Text('$value', textAlign: TextAlign.center, style: Type.strong, semanticsLabel: 'Quantity $value')),
        IconButton(tooltip: 'One more', onPressed: busy || value >= max ? null : () => onChanged(value + 1), icon: const Icon(Icons.add, color: Brand.ivory)),
      ]),
    );
  }
}

void showMessage(BuildContext context, String message, {SnackBarAction? action}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), action: action));
}

/// A text field with the label above it, as in the designs.
class LabelledField extends StatelessWidget {
  const LabelledField({
    super.key,
    required this.label,
    required this.controller,
    this.error,
    this.help,
    this.keyboardType,
    this.obscure = false,
    this.autofill,
    this.textInputAction = TextInputAction.next,
    this.maxLines = 1,
    this.onSubmitted,
    this.textCapitalization = TextCapitalization.none,
  });

  final String label;
  final TextEditingController controller;
  final String? error;
  final String? help;
  final TextInputType? keyboardType;
  final bool obscure;
  final Iterable<String>? autofill;
  final TextInputAction textInputAction;
  final int maxLines;
  final ValueChanged<String>? onSubmitted;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ExcludeSemantics(child: Text(label, style: Type.strong)),
        const SizedBox(height: 6),
        Semantics(
          label: label,
          child: TextField(
          controller: controller,
          keyboardType: keyboardType,
          obscureText: obscure,
          autofillHints: autofill,
          textInputAction: textInputAction,
          maxLines: obscure ? 1 : maxLines,
          onSubmitted: onSubmitted,
          textCapitalization: textCapitalization,
          style: Type.body,
            decoration: InputDecoration(errorText: error, helperText: help, helperMaxLines: 3, errorMaxLines: 3),
          ),
        ),
      ]),
    );
  }
}
