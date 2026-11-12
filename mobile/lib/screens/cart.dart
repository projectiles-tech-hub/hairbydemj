import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// The bag: quantities, discount and gift card codes, totals and checkout.
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final _code = TextEditingController();
  final Set<int> _busy = {};
  bool _applying = false;
  String? _codeError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => AppScope.read(context).refreshCart());
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _line(int id, Future<void> Function() change) async {
    setState(() => _busy.add(id));
    try {
      await change();
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  /// One box for both: a discount code first, and if it is not one, a gift card.
  Future<void> _apply() async {
    final code = _code.text.trim();
    if (code.isEmpty) return;
    final state = AppScope.read(context);
    setState(() {
      _applying = true;
      _codeError = null;
    });
    try {
      await state.applyCode(code);
      _code.clear();
    } on ApiError catch (first) {
      try {
        await state.addGiftCard(code);
        _code.clear();
      } on ApiError {
        setState(() => _codeError = first.fields['code'] ?? first.message);
      }
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final cart = state.cart;
    final c = cart.currency;
    return Scaffold(
      appBar: AppBar(title: Text(cart.itemCount > 0 ? 'Your bag (${cart.itemCount})' : 'Your bag')),
      body: cart.lines.isEmpty
          ? StateMessage(icon: Icons.shopping_bag_outlined, title: 'Your bag is empty', body: 'Find your next look in the shop.', action: 'Start shopping', onAction: () => Shell.goTo(context, Shell.shop))
          : RefreshIndicator(
              onRefresh: state.refreshCart,
              child: ListView(padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 24), children: [
                for (final line in cart.lines) _LineRow(line: line, currency: c, busy: _busy.contains(line.id), onQuantity: (q) => _line(line.id, () => state.setQuantity(line.id, q)), onRemove: () => _line(line.id, () => state.removeLine(line.id))),
                const SizedBox(height: 16),
                const Text('Discount or gift card code', style: Type.strong),
                const SizedBox(height: 8),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(
                    child: Semantics(
                      label: 'Discount or gift card code',
                      child: TextField(controller: _code, textCapitalization: TextCapitalization.characters, onSubmitted: (_) => _apply(), style: Type.body, decoration: InputDecoration(errorText: _codeError, errorMaxLines: 3)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  BusyButton(label: 'Apply', onPressed: _apply, busy: _applying, outlined: true, expand: false),
                ]),
                if (cart.code != null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('Code ${cart.code}', style: Type.body),
                    subtitle: cart.discounts.isEmpty ? null : Text(cart.discounts.join(', '), style: Type.small),
                    trailing: TextButton(onPressed: () => _line(-1, state.removeCode), child: const Text('Remove')),
                  ),
                for (final g in cart.giftCards)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('Gift card ending ${g['last4'] ?? ''}', style: Type.body),
                    subtitle: g['appliedMinor'] is num ? Text('${money((g['appliedMinor'] as num).toInt(), c)} used', style: Type.small) : null,
                    trailing: TextButton(onPressed: () => _line(-2, () => state.removeGiftCard((g['id'] as num).toInt())), child: const Text('Remove')),
                  ),
                const SizedBox(height: 16),
                SummaryPanel(rows: [
                  ('Subtotal', money(cart.subtotalMinor, c)),
                  if (cart.discountMinor > 0) ('Discount', '-${money(cart.discountMinor, c)}'),
                  if (cart.giftCardMinor > 0) ('Gift cards', '-${money(cart.giftCardMinor, c)}'),
                  ('Delivery', cart.freeShipping ? 'Free' : 'At checkout'),
                  ('Duties and taxes', 'Paid on delivery, outside Nigeria'),
                ]),
              ]),
            ),
      bottomNavigationBar: cart.lines.isEmpty
          ? null
          : SafeArea(
              child: Container(
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.line))),
                padding: const EdgeInsets.fromLTRB(Brand.gutter, 12, Brand.gutter, 12),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Row(children: [const Expanded(child: Text('Total', style: Type.body)), Text(money(cart.totalMinor, c), style: Type.strong)]),
                  const SizedBox(height: 8),
                  BusyButton(label: 'Checkout', onPressed: cart.canCheckout ? () => Navigator.of(context, rootNavigator: true).pushNamed('/checkout') : null),
                  if (!cart.canCheckout) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Change the items marked above to check out.', style: Type.small)),
                ]),
              ),
            ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.currency, required this.busy, required this.onQuantity, required this.onRemove});

  final CartLine line;
  final String currency;
  final bool busy;
  final ValueChanged<int> onQuantity;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Brand.line))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 80, child: Photo(picture: line.image, aspect: 4 / 5, radius: Brand.radiusControl, want: 320, label: line.name)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: InkWell(onTap: () => Navigator.of(context).pushNamed('/product', arguments: line.slug), child: Text(line.name, style: Type.strong))),
              IconButton(tooltip: 'Remove ${line.name}', onPressed: busy ? null : onRemove, icon: const Icon(Icons.close, size: 20, color: Brand.textMuted)),
            ]),
            if (line.description.isNotEmpty) Text(line.description, style: Type.small),
            if (line.problem != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_problemWords(line), style: Type.small.copyWith(color: Brand.error))),
            const SizedBox(height: 8),
            Wrap(spacing: 12, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              QuantityStepper(value: line.quantity, max: line.available > 0 ? line.available : line.quantity, busy: busy, onChanged: onQuantity),
              Text(money(line.lineMinor, currency), style: Type.strong),
            ]),
          ]),
        ),
      ]),
    );
  }
}

String _problemWords(CartLine line) => switch (line.problem) {
      'sold_out' => 'Sold out. Remove it to check out.',
      'not_enough_stock' => 'Only ${line.available} left. Lower the quantity to check out.',
      'no_price' => 'Not sold in this currency. Remove it or change currency.',
      _ => 'No longer available. Remove it to check out.',
    };
