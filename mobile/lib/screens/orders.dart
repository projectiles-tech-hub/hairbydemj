import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../config.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../util/places.dart';
import '../widgets/common.dart';
import 'checkout.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  final _orders = <OrderSummary>[];
  int _page = 0;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _next());
  }

  Future<void> _next() async {
    if (_loading || !_more) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await AppScope.read(context).api.get('/v1/orders', {'page': '${_page + 1}'});
      setState(() {
        _orders.addAll(((r['orders'] as List?) ?? const []).whereType<Map>().map((m) => OrderSummary(m.cast<String, dynamic>())));
        _page++;
        _more = r['more'] == true;
      });
    } on ApiError catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_orders.isEmpty && _error != null) {
      body = StateMessage.error(_error!, _next);
    } else if (_orders.isEmpty && _loading) {
      body = const Loading();
    } else if (_orders.isEmpty) {
      body = const StateMessage(icon: Icons.receipt_long_outlined, title: 'No orders yet', body: 'Orders you place appear here, with tracking.');
    } else {
      body = ListView(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), children: [
        for (final o in _orders)
          LinkRow(
            'Order ${o.number}',
            subtitle: '${orderStatusWords(o.status)}\n${shortDate(o.placedAt)} · ${o.itemCount} ${o.itemCount == 1 ? 'item' : 'items'} · ${money(o.totalMinor, o.currency)}',
            onTap: () => Navigator.of(context).pushNamed('/order', arguments: o.number),
          ),
        if (_more) Padding(padding: const EdgeInsets.all(16), child: _loading ? const Loading() : TextButton(onPressed: _next, child: const Text('Show older orders'))),
      ]);
    }
    return Scaffold(appBar: AppBar(title: const Text('Orders')), body: body);
  }
}

/// One order: items, totals, delivery and tracking, and what can be done.
class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key, required this.number});
  final String number;

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  Future<Order>? _load;
  bool _busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= _fetch();
  }

  Future<Order> _fetch() async {
    final api = AppScope.read(context).api;
    final token = await api.store.read('order:${widget.number}');
    return Order((await api.get('/v1/orders/${Uri.encodeComponent(widget.number)}', {'token': token}))['order'] as Json);
  }

  void _reload() => setState(() => _load = _fetch());

  Future<void> _act(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(Order o) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('Cancel order ${o.number}?'),
        content: const Text('Anything you have paid is refunded to the way you paid.', style: Type.body),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep the order')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cancel the order'))],
      ),
    );
    if (yes != true) return;
    await _act(() async {
      await AppScope.read(context).api.post('/v1/orders/${Uri.encodeComponent(o.number)}/cancel');
      if (mounted) showMessage(context, 'Your order is cancelled.');
      _reload();
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Order>(
      future: _load,
      builder: (context, snap) {
        if (snap.hasError) return Scaffold(appBar: AppBar(), body: StateMessage.error(snap.error!, _reload));
        if (!snap.hasData) return Scaffold(appBar: AppBar(title: Text('Order ${widget.number}')), body: const Loading());
        final o = snap.data!;
        final c = o.currency;
        return Scaffold(
          appBar: AppBar(title: Text('Order ${o.number}')),
          body: RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 32), children: [
              Text('${orderStatusWords(o.status)} · placed ${shortDate(o.placedAt)}', style: Type.h3),
              if (o.paymentStatus == 'awaiting') const Padding(padding: EdgeInsets.only(top: 4), child: Text('Waiting for your payment. Unpaid orders are cancelled after a short while.', style: Type.small)),
              if (o.deliveryService != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${o.deliveryService}${o.deliveryEstimate == null ? '' : ', ${o.deliveryEstimate}'}', style: Type.small)),
              const SizedBox(height: 16),
              if (o.canPay) Padding(padding: const EdgeInsets.only(bottom: 12), child: BusyButton(label: 'Pay ${money(o.amountDueMinor, c)}', busy: _busy, onPressed: () => _act(() async => payForOrder(context, o.number)))),
              if (o.canReturn) Padding(padding: const EdgeInsets.only(bottom: 12), child: BusyButton(label: 'Return items', outlined: true, onPressed: () async {
                final sent = await Navigator.of(context).pushNamed('/return', arguments: o);
                if (sent == true) _reload();
              })),
              for (final s in o.shipments) _ShipmentCard(shipment: s),
              const SectionHead('Items'),
              for (final i in o.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(i.name, style: Type.strong), if (i.description.isNotEmpty) Text(i.description, style: Type.small), Text('Quantity ${i.quantity}', style: Type.small)])),
                    Text(money(i.totalMinor, c), style: Type.body),
                  ]),
                ),
              SummaryPanel(
                rows: [
                  ('Items', money(o.subtotalMinor, c)),
                  if (o.discountMinor > 0) ('Discount', '-${money(o.discountMinor, c)}'),
                  ('Delivery', o.shippingMinor == 0 ? 'Free' : money(o.shippingMinor, c)),
                  if (o.giftCardMinor > 0) ('Gift cards', '-${money(o.giftCardMinor, c)}'),
                  if (o.refundedMinor > 0) ('Refunded', money(o.refundedMinor, c)),
                ],
                total: ('Total', money(o.totalMinor, c)),
              ),
              if (o.dutiesNotice) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Import duties and taxes are paid by you to the carrier on delivery.', style: Type.small)),
              if (o.address != null) ...[
                const SectionHead('Delivering to'),
                Text('${o.address!.name}\n${o.address!.line1}${o.address!.line2.isEmpty ? '' : '\n${o.address!.line2}'}\n${o.address!.city}${o.address!.region.isEmpty ? '' : ', ${o.address!.region}'}\n${countryName(o.address!.country)}\n${o.address!.phone}', style: Type.body),
              ],
              if (o.returns.isNotEmpty) ...[
                const SectionHead('Returns'),
                for (final r in o.returns)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('Return ${r.number}', style: Type.strong),
                    subtitle: Text('${_returnWords(r.status)} · ${shortDate(r.requestedAt)}${r.refundMinor > 0 ? ' · ${money(r.refundMinor, c)}' : ''}', style: Type.small),
                    trailing: r.status == 'requested'
                        ? TextButton(
                            onPressed: () => _act(() async {
                              await AppScope.read(context).api.post('/v1/orders/${Uri.encodeComponent(o.number)}/returns/${r.id}/cancel');
                              _reload();
                            }),
                            child: const Text('Withdraw'),
                          )
                        : null,
                  ),
              ],
              const SizedBox(height: 16),
              if (o.paymentStatus != 'awaiting' && o.paymentStatus != 'failed')
                TextButton.icon(
                  icon: const Icon(Icons.description_outlined),
                  onPressed: () => launchUrl(Uri.parse('${AppConfig.siteBase}/account/orders/${o.number.toLowerCase()}/'), mode: LaunchMode.externalApplication),
                  label: const Text('Invoice (opens the website)'),
                ),
              if (o.canCancel) TextButton(onPressed: _busy ? null : () => _cancel(o), child: Text('Cancel this order', style: Type.strong.copyWith(color: Brand.error))),
              TextButton(onPressed: () => Navigator.of(context).pushNamed('/help'), child: const Text('Need help with this order?')),
            ]),
          ),
        );
      },
    );
  }
}

String _returnWords(String s) => switch (s) {
      'requested' => 'Waiting for a decision',
      'approved' => 'Approved: send the items back',
      'rejected' => 'Declined',
      'received' => 'Received',
      'refunded' => 'Refunded',
      'cancelled' => 'Withdrawn',
      _ => s,
    };

class _ShipmentCard extends StatelessWidget {
  const _ShipmentCard({required this.shipment});
  final Shipment shipment;

  @override
  Widget build(BuildContext context) {
    final s = shipment;
    final words = switch (s.status) {
      'pending' || 'label_bought' => 'Being prepared',
      'in_transit' => 'In transit',
      'out_for_delivery' => 'Out for delivery',
      'delivered' => 'Delivered',
      'exception' => 'Delayed: the carrier is sorting it out',
      'returned' => 'Returned to us',
      _ => s.status,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Brand.espresso, borderRadius: BorderRadius.circular(Brand.radiusCard)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${s.carrierName}: $words', style: Type.strong),
        if (s.trackingNumber != null) Text('Tracking number ${s.trackingNumber}', style: Type.small),
        const SizedBox(height: 8),
        for (final e in s.events.take(5))
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text('${shortDate(e.occurredAt)}: ${e.description}${e.location == null ? '' : ', ${e.location}'}', style: Type.small.copyWith(color: Brand.ivory)),
          ),
        if (s.trackingUrl != null) TextButton(onPressed: () => launchUrl(Uri.parse(s.trackingUrl!), mode: LaunchMode.externalApplication), child: const Text('Track on the carrier\'s site')),
      ]),
    );
  }
}

/// Choosing items to send back, why, and money back or store credit.
class ReturnRequestScreen extends StatefulWidget {
  const ReturnRequestScreen({super.key, required this.order});
  final Order order;

  @override
  State<ReturnRequestScreen> createState() => _ReturnRequestScreenState();
}

class _ReturnRequestScreenState extends State<ReturnRequestScreen> {
  final Map<int, int> _quantity = {};
  final Map<int, String> _reason = {};
  final _note = TextEditingController();
  String _resolution = 'refund';
  bool _busy = false;
  String? _error;

  static const reasons = <String, String>{
    'wrong_item': 'We sent the wrong item',
    'wrong_length': 'Wrong length',
    'damaged': 'Arrived damaged',
    'not_as_described': 'Not as described',
    'changed_mind': 'Changed my mind',
    'other': 'Something else',
  };

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final items = [
      for (final e in _quantity.entries)
        if (e.value > 0) {'orderItemId': e.key, 'quantity': e.value, 'reason': _reason[e.key] ?? 'other'},
    ];
    if (items.isEmpty) {
      setState(() => _error = 'Choose the items to send back.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).api.post('/v1/orders/${Uri.encodeComponent(widget.order.number)}/returns', {'items': items, 'resolution': _resolution, if (_note.text.trim().isNotEmpty) 'note': _note.text.trim()});
      if (!mounted) return;
      showMessage(context, 'Return requested. We will email you what happens next.');
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      setState(() => _error = e.fields.values.firstOrNull ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.order.items.where((i) => i.returnableQuantity > 0).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Return items')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        const Text('Choose what to send back. Hair must be unworn and in its original packaging, unless it arrived wrong or damaged.', style: Type.body),
        for (final i in items) ...[
          const SizedBox(height: 16),
          Text(i.name, style: Type.strong),
          if (i.description.isNotEmpty) Text(i.description, style: Type.small),
          if (i.isFinalSale) const Text('Final sale: only if wrong or damaged.', style: Type.small),
          const SizedBox(height: 8),
          Row(children: [
            QuantityStepper(value: _quantity[i.id] ?? 0, max: i.returnableQuantity, onChanged: (q) => setState(() => _quantity[i.id] = q)),
            const SizedBox(width: 12),
            if ((_quantity[i.id] ?? 0) == 0) TextButton(onPressed: () => setState(() => _quantity[i.id] = 1), child: const Text('Return this')),
          ]),
          if ((_quantity[i.id] ?? 0) > 0)
            DropdownButtonFormField<String>(
              initialValue: _reason[i.id],
              isExpanded: true,
              dropdownColor: Brand.espresso,
              style: Type.body,
              hint: const Text('Why are you returning it?', style: Type.small),
              items: [for (final e in reasons.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
              onChanged: (v) => setState(() => _reason[i.id] = v ?? 'other'),
            ),
        ],
        const SectionHead('How would you like it back?'),
        RadioGroup<String>(
          groupValue: _resolution,
          onChanged: (v) => setState(() => _resolution = v ?? 'refund'),
          child: const Column(children: [
            RadioListTile<String>(contentPadding: EdgeInsets.zero, value: 'refund', title: Text('Money back', style: Type.body), subtitle: Text('To the way you paid.', style: Type.small)),
            RadioListTile<String>(contentPadding: EdgeInsets.zero, value: 'store_credit', title: Text('Store credit', style: Type.body), subtitle: Text('A gift card with a little extra on top.', style: Type.small)),
          ]),
        ),
        const SectionHead('Anything to add? (optional)'),
        Semantics(label: 'Anything to add', child: TextField(controller: _note, maxLines: 3, style: Type.body)),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: Type.body.copyWith(color: Brand.error))),
        const SizedBox(height: 16),
        BusyButton(label: 'Request a return', busy: _busy, onPressed: _send),
      ]),
    );
  }
}
