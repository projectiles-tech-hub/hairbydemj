import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../config.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../widgets/address_fields.dart';
import '../widgets/common.dart';

/// Opens the payment page for an order: Paystack's page for naira, and the
/// order's page on our website (Stripe's card form) for other currencies.
/// Returns false when nothing could be opened.
Future<bool> payForOrder(BuildContext context, String number, {String? token}) async {
  final state = AppScope.read(context);
  final saved = token ?? await state.api.store.read('order:$number');
  final r = await state.api.post('/v1/orders/${Uri.encodeComponent(number)}/pay${saved == null ? '' : '?token=${Uri.encodeQueryComponent(saved)}'}');
  final payment = (r['payment'] as Map?)?.cast<String, dynamic>() ?? const {};
  final paystack = payment['authorizationUrl'];
  Uri? target;
  if (paystack is String && paystack.startsWith('https://')) {
    target = Uri.parse(paystack);
  } else if (saved != null) {
    target = Uri.parse('${AppConfig.siteBase}/track-order/').replace(queryParameters: {'order': number, 'token': saved});
  } else {
    target = Uri.parse('${AppConfig.siteBase}/account/orders/${number.toLowerCase()}/');
  }
  return launchUrl(target, mode: LaunchMode.externalApplication);
}

/// Checkout: contact, address, delivery options, review, then pay.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _email = TextEditingController();
  final _address = AddressController();
  final _note = TextEditingController();
  Map<String, String> _errors = {};
  List<Address> _saved = [];
  Quote? _quote;
  String? _option;
  bool _quoting = false;
  bool _placing = false;
  bool _marketing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSaved());
  }

  @override
  void dispose() {
    _email.dispose();
    _address.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadSaved() async {
    final state = AppScope.read(context);
    if (!state.signedIn) return;
    try {
      final r = await state.api.get('/v1/account/addresses');
      final list = ((r['addresses'] as List?) ?? const []).whereType<Map>().map((m) => Address.fromJson(m.cast<String, dynamic>())).toList();
      setState(() {
        _saved = list;
        final preferred = list.where((a) => a.isDefault).followedBy(list).firstOrNull;
        if (preferred != null) _address.fill(preferred);
      });
    } on ApiError {
      // The form is still there to fill in.
    }
  }

  Future<void> _getOptions() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _quoting = true;
      _errors = {};
      _error = null;
      _quote = null;
      _option = null;
    });
    try {
      final r = await AppScope.read(context).api.post('/v1/shipping/quote', {'address': _address.value().toJson()});
      final q = Quote(r['quote'] as Json);
      setState(() {
        _quote = q;
        _option = q.options.isEmpty ? null : q.options.first.id;
      });
    } on ApiError catch (e) {
      setState(() {
        _errors = e.fields;
        _error = e.message;
      });
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Future<void> _place() async {
    final state = AppScope.read(context);
    final q = _quote;
    if (q == null || _option == null) return;
    setState(() {
      _placing = true;
      _error = null;
      _errors = {};
    });
    try {
      final r = await state.api.post('/v1/checkout', {
        if (!state.signedIn) 'email': _email.text.trim(),
        if (!state.signedIn) 'marketingConsent': _marketing,
        'address': _address.value().toJson(),
        'quoteId': q.id,
        'shippingOption': _option,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      final order = Order(r['order'] as Json);
      final token = r['orderToken'];
      if (token is String) await state.api.store.write('order:${order.number}', token);
      state.cartEmptied();
      if (!mounted) return;
      final due = (r['amountDueMinor'] as num?)?.toInt() ?? order.amountDueMinor;
      if (due > 0) {
        try {
          await payForOrder(context, order.number, token: token is String ? token : null);
        } on ApiError catch (e) {
          if (mounted) showMessage(context, e.message);
        }
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed('/complete', arguments: order.number);
    } on ApiError catch (e) {
      setState(() {
        _errors = e.fields;
        _error = e.message;
        // An old quote must be fetched again.
        if (e.fields.containsKey('quoteId') || e.code == 'quote_expired') _quote = null;
      });
    } finally {
      if (mounted) setState(() => _placing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final cart = state.cart;
    final c = cart.currency;
    final chosen = _quote?.options.where((o) => o.id == _option).firstOrNull;
    final total = cart.totalMinor + (chosen?.priceMinor ?? 0);
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 32), children: [
        const SectionHead('Contact'),
        if (state.signedIn)
          Text('Signed in as ${state.customer!.email}', style: Type.body)
        else ...[
          LabelledField(label: 'Email (for your receipt and tracking)', controller: _email, error: _errors['email'], keyboardType: TextInputType.emailAddress, autofill: const [AutofillHints.email]),
          CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _marketing, onChanged: (v) => setState(() => _marketing = v ?? false), title: const Text('Email me offers and new arrivals', style: Type.body)),
          TextButton(onPressed: () => Navigator.of(context).pushNamed('/sign-in'), child: const Text('Have an account? Sign in')),
        ],
        const SectionHead('Delivery address'),
        if (_saved.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Wrap(spacing: 8, runSpacing: 8, children: [
              for (final a in _saved)
                ActionChip(
                  label: Text(a.label.isNotEmpty ? a.label : a.line1),
                  onPressed: () => setState(() {
                    _address.fill(a);
                    _quote = null;
                  }),
                ),
            ]),
          ),
        AddressFields(controller: _address, errors: _errors),
        BusyButton(label: _quote == null ? 'Show delivery options' : 'Update delivery options', outlined: _quote != null, busy: _quoting, onPressed: _getOptions),
        if (_quote != null) ...[
          const SectionHead('Delivery'),
          if (_quote!.options.isEmpty) Text(_quote!.message ?? 'We cannot deliver to this address yet. Contact us and we will help.', style: Type.body),
          RadioGroup<String>(
            groupValue: _option,
            onChanged: (v) => setState(() => _option = v),
            child: Column(children: [
              for (final o in _quote!.options)
                RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  value: o.id,
                  title: Text('${o.carrierName}: ${o.serviceName}', style: Type.body),
                  subtitle: Text(o.estimate, style: Type.small),
                  secondary: Text(o.priceMinor == 0 ? 'Free' : money(o.priceMinor, c), style: Type.strong),
                ),
            ]),
          ),
          if (_quote!.dutiesNotice != null)
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Brand.goldSoft, borderRadius: BorderRadius.circular(Brand.radiusControl)),
              child: Text(_quote!.dutiesNotice!, style: Type.body),
            ),
          const SectionHead('Note for us (optional)'),
          Semantics(label: 'Note for us', child: TextField(controller: _note, maxLines: 3, style: Type.body)),
          const SectionHead('Summary'),
          SummaryPanel(
            rows: [
              ('Items (${cart.itemCount})', money(cart.subtotalMinor, c)),
              if (cart.discountMinor > 0) ('Discount', '-${money(cart.discountMinor, c)}'),
              if (cart.giftCardMinor > 0) ('Gift cards', '-${money(cart.giftCardMinor, c)}'),
              ('Delivery', chosen == null ? '' : (chosen.priceMinor == 0 ? 'Free' : money(chosen.priceMinor, c))),
            ],
            total: ('Total', money(total, c)),
          ),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error!, style: Type.body.copyWith(color: Brand.error))),
      ]),
      bottomNavigationBar: _quote == null || _option == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(Brand.gutter),
                child: BusyButton(label: 'Place order and pay ${money(total, c)}', busy: _placing, onPressed: _place),
              ),
            ),
    );
  }
}

/// After paying: checks with the shop until the payment is confirmed.
class OrderCompleteScreen extends StatefulWidget {
  const OrderCompleteScreen({super.key, required this.number});
  final String number;

  @override
  State<OrderCompleteScreen> createState() => _OrderCompleteScreenState();
}

class _OrderCompleteScreenState extends State<OrderCompleteScreen> with WidgetsBindingObserver {
  Json? _status;
  Timer? _timer;
  int _checks = 0;
  bool _paying = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // Back from the payment page: look straight away.
    if (s == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    final api = AppScope.read(context).api;
    _checks++;
    try {
      final token = await api.store.read('order:${widget.number}');
      final r = await api.get('/v1/orders/${Uri.encodeComponent(widget.number)}/payment', {'token': token});
      if (!mounted) return;
      setState(() => _status = r);
      final paid = r['paymentStatus'] != 'awaiting' && r['paymentStatus'] != 'failed';
      if (paid || _checks > 120) _timer?.cancel();
    } on ApiError {
      // Try again on the next tick.
    }
  }

  Future<void> _pay() async {
    setState(() => _paying = true);
    try {
      await payForOrder(context, widget.number);
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    final payment = s?['paymentStatus'];
    final paid = payment != null && payment != 'awaiting' && payment != 'failed';
    final failed = payment == 'failed';
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: false, title: Text('Order ${widget.number}')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Icon(paid ? Icons.check_circle_outline : (failed ? Icons.error_outline : Icons.hourglass_top), size: 56, color: failed ? Brand.error : Brand.gold),
          const SizedBox(height: 16),
          Text(paid ? 'Thank you for your order' : (failed ? 'The payment did not go through' : 'Waiting for your payment'), style: Type.h1, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            paid
                ? 'We have emailed your receipt. We will let you know when it is on its way.'
                : failed
                    ? '${s?['lastFailure'] ?? 'Your bank did not approve it.'} You can try again; your order is kept for a short while.'
                    : 'Finish paying on the payment page. This screen updates by itself when the payment is confirmed.',
            style: Type.body,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),
          if (!paid) BusyButton(label: failed ? 'Try again' : 'Open the payment page', busy: _paying, onPressed: _pay),
          if (!paid) const SizedBox(height: 12),
          if (state.signedIn) BusyButton(label: 'View my order', outlined: true, onPressed: () => Navigator.of(context).pushReplacementNamed('/order', arguments: widget.number)),
          const SizedBox(height: 12),
          TextButton(onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst), child: const Text('Continue shopping')),
        ]),
      ),
    );
  }
}
