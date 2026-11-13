import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../config.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../util/places.dart';
import '../widgets/address_fields.dart';
import '../widgets/common.dart';

/// Account: a greeting, then orders, wishlist, addresses and settings.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final nav = Navigator.of(context);
    final c = state.customer;
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), children: [
        Container(
          padding: const EdgeInsets.all(16),
          margin: const EdgeInsets.only(bottom: 8),
          decoration: BoxDecoration(color: Brand.espresso, borderRadius: BorderRadius.circular(Brand.radiusCard)),
          child: c == null
              ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Welcome', style: Type.h2),
                  const SizedBox(height: 4),
                  const Text('Sign in to track orders, save addresses and keep a wishlist.', style: Type.body),
                  const SizedBox(height: 16),
                  Row(children: [
                    Expanded(child: BusyButton(label: 'Sign in', onPressed: () => nav.pushNamed('/sign-in'))),
                    const SizedBox(width: 12),
                    Expanded(child: BusyButton(label: 'Create account', outlined: true, onPressed: () => nav.pushNamed('/sign-up'))),
                  ]),
                ])
              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Hello, ${c.firstName.isNotEmpty ? c.firstName : 'there'}', style: Type.h2),
                  const SizedBox(height: 4),
                  Text(c.email, style: Type.small),
                ]),
        ),
        if (c != null) ...[
          LinkRow('Orders', onTap: () => nav.pushNamed('/orders')),
          LinkRow('Wishlist', onTap: () => nav.pushNamed('/wishlist')),
          LinkRow('Points and referrals', onTap: () => nav.pushNamed('/loyalty')),
          LinkRow('Reviews', onTap: () => nav.pushNamed('/reviews')),
          LinkRow('Addresses', onTap: () => nav.pushNamed('/addresses')),
          LinkRow('Notifications', trailing: state.unread > 0 ? Badge(label: Text('${state.unread}'), backgroundColor: Brand.gold, textColor: Brand.noir) : null, onTap: () => nav.pushNamed('/notifications')),
          LinkRow('Profile and security', onTap: () => nav.pushNamed('/profile')),
        ] else
          LinkRow('Track an order', onTap: () => launchUrl(Uri.parse('${AppConfig.siteBase}/track-order/'), mode: LaunchMode.externalApplication)),
        LinkRow('Gift cards', onTap: () => nav.pushNamed('/gift-cards')),
        LinkRow('Settings', onTap: () => nav.pushNamed('/settings')),
        LinkRow('Help and contact', onTap: () => nav.pushNamed('/help')),
        if (c != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: BusyButton(label: 'Sign out', outlined: true, onPressed: () => state.signOut()),
          ),
      ]),
    );
  }
}

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _phone = TextEditingController();
  final _birthday = TextEditingController();
  bool _loaded = false;
  bool _busy = false;
  bool _hasPassword = true;
  String _email = '';
  Object? _error;
  Map<String, String> _fields = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    for (final c in [_first, _last, _phone, _birthday]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = (await AppScope.read(context).api.get('/v1/account/profile'))['profile'] as Json;
      setState(() {
        _first.text = '${p['firstName'] ?? ''}';
        _last.text = '${p['lastName'] ?? ''}';
        _phone.text = '${p['phone'] ?? ''}';
        _birthday.text = '${p['birthday'] ?? ''}';
        _email = '${p['email']}';
        _hasPassword = p['hasPassword'] == true;
        _loaded = true;
      });
    } on ApiError catch (e) {
      setState(() => _error = e);
    }
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _fields = {};
    });
    try {
      await AppScope.read(context).api.post('/v1/account/profile', {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'phone': _phone.text.trim(),
        'birthday': _birthday.text.trim(),
      });
      if (mounted) showMessage(context, 'Saved.');
    } on ApiError catch (e) {
      setState(() => _fields = e.fields);
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile and security')),
      body: _error != null
          ? StateMessage.error(_error!, () {
              setState(() => _error = null);
              _load();
            })
          : !_loaded
              ? const Loading()
              : ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
                  Text('Email: $_email', style: Type.body),
                  const Text('To change your email, contact us and we will help.', style: Type.small),
                  const SizedBox(height: 24),
                  LabelledField(label: 'First name', controller: _first, error: _fields['firstName'], textCapitalization: TextCapitalization.words),
                  LabelledField(label: 'Last name', controller: _last, error: _fields['lastName'], textCapitalization: TextCapitalization.words),
                  LabelledField(label: 'Phone', controller: _phone, error: _fields['phone'], keyboardType: TextInputType.phone),
                  LabelledField(label: 'Birthday (optional)', controller: _birthday, error: _fields['birthday'], help: 'As YYYY-MM-DD, for example 1995-04-21.', keyboardType: TextInputType.datetime),
                  BusyButton(label: 'Save details', busy: _busy, onPressed: _save),
                  const SizedBox(height: 32),
                  LinkRow(_hasPassword ? 'Change password' : 'Set a password', onTap: () => Navigator.of(context).pushNamed('/password')),
                  LinkRow('Delete my account', onTap: () => Navigator.of(context).pushNamed('/delete-account')),
                ]),
    );
  }
}

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;
  Map<String, String> _fields = {};
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _fields = {};
      _error = null;
    });
    try {
      await AppScope.read(context).api.post('/v1/account/password', {'currentPassword': _current.text, 'newPassword': _next.text});
      if (!mounted) return;
      showMessage(context, 'Password changed.');
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      setState(() {
        _fields = e.fields;
        _error = e.fields.isEmpty ? e.message : null;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasPassword = AppScope.of(context).customer?.hasPassword ?? true;
    return Scaffold(
      appBar: AppBar(title: Text(hasPassword ? 'Change password' : 'Set a password')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        if (hasPassword) LabelledField(label: 'Current password', controller: _current, error: _fields['currentPassword'], obscure: true, autofill: const [AutofillHints.password]),
        LabelledField(label: 'New password', controller: _next, error: _fields['newPassword'], obscure: true, help: 'At least 8 characters.', autofill: const [AutofillHints.newPassword], textInputAction: TextInputAction.done),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: Type.body.copyWith(color: Brand.error))),
        BusyButton(label: 'Save password', busy: _busy, onPressed: _save),
      ]),
    );
  }
}

class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _password = TextEditingController();
  bool _confirm = false;
  bool _busy = false;
  Map<String, String> _fields = {};

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    final state = AppScope.read(context);
    setState(() {
      _busy = true;
      _fields = {};
    });
    try {
      await state.api.post('/v1/account/delete', {'password': _password.text, 'confirm': _confirm});
      await state.signOut();
      if (!mounted) return;
      showMessage(context, 'Your account has been deleted.');
      Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiError catch (e) {
      setState(() => _fields = e.fields);
      if (mounted && e.fields.isEmpty) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasPassword = AppScope.of(context).customer?.hasPassword ?? true;
    return Scaffold(
      appBar: AppBar(title: const Text('Delete my account')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        const Text('This removes your account, saved addresses, wishlist and preferences. Orders you have placed are kept for our tax records, without your account. This cannot be undone.', style: Type.body),
        const SizedBox(height: 24),
        if (hasPassword)
          LabelledField(label: 'Your password, to confirm', controller: _password, error: _fields['password'], obscure: true, textInputAction: TextInputAction.done)
        else
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _confirm,
            onChanged: (v) => setState(() => _confirm = v ?? false),
            title: const Text('I understand my account will be deleted', style: Type.body),
            subtitle: _fields['confirm'] == null ? null : Text(_fields['confirm']!, style: Type.small.copyWith(color: Brand.error)),
          ),
        const SizedBox(height: 8),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.error), onPressed: _busy ? null : _delete, child: Text(_busy ? 'Deleting…' : 'Delete my account')),
      ]),
    );
  }
}

class AddressesScreen extends StatefulWidget {
  const AddressesScreen({super.key});

  @override
  State<AddressesScreen> createState() => _AddressesScreenState();
}

class _AddressesScreenState extends State<AddressesScreen> {
  Future<List<Address>>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= _fetch();
  }

  Future<List<Address>> _fetch() async {
    final r = await AppScope.read(context).api.get('/v1/account/addresses');
    return ((r['addresses'] as List?) ?? const []).whereType<Map>().map((m) => Address.fromJson(m.cast<String, dynamic>())).toList();
  }

  Future<void> _open([Address? a]) async {
    final changed = await Navigator.of(context).pushNamed('/address', arguments: a);
    if (changed == true) setState(() => _load = _fetch());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Addresses')),
      floatingActionButton: FloatingActionButton.extended(backgroundColor: Brand.gold, foregroundColor: Brand.noir, onPressed: () => _open(), icon: const Icon(Icons.add), label: const Text('Add an address')),
      body: FutureBuilder<List<Address>>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, () => setState(() => _load = _fetch()));
          if (!snap.hasData) return const Loading();
          final list = snap.data!;
          if (list.isEmpty) return const StateMessage(icon: Icons.home_outlined, title: 'No saved addresses', body: 'Save an address to check out faster.');
          return ListView(padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 96), children: [
            for (final a in list)
              LinkRow(
                '${a.label.isNotEmpty ? a.label : a.name}${a.isDefault ? ' (default)' : ''}',
                subtitle: '${a.name}, ${a.line1}, ${a.city}, ${countryName(a.country)}',
                onTap: () => _open(a),
              ),
          ]);
        },
      ),
    );
  }
}

class AddressFormScreen extends StatefulWidget {
  const AddressFormScreen({super.key, this.address});
  final Address? address;

  @override
  State<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<AddressFormScreen> {
  late final _fields = AddressController(widget.address);
  late final _label = TextEditingController(text: widget.address?.label);
  late bool _default = widget.address?.isDefault ?? false;
  bool _busy = false;
  Map<String, String> _errors = {};

  @override
  void dispose() {
    _fields.dispose();
    _label.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final api = AppScope.read(context).api;
    setState(() {
      _busy = true;
      _errors = {};
    });
    try {
      final a = _fields.value(label: _label.text.trim(), isDefault: _default);
      final id = widget.address?.id;
      await api.post(id == null ? '/v1/account/addresses' : '/v1/account/addresses/$id', a.toJson());
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      setState(() => _errors = e.fields);
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remove this address?'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep it')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Remove'))],
      ),
    );
    if (yes != true || !mounted) return;
    try {
      await AppScope.read(context).api.post('/v1/account/addresses/${widget.address!.id}/delete');
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.address != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit address' : 'Add an address'), actions: [if (editing) IconButton(tooltip: 'Remove address', onPressed: _delete, icon: const Icon(Icons.delete_outline))]),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        LabelledField(label: 'Name for this address (optional)', controller: _label, help: 'For example: Home, Office', error: _errors['label']),
        AddressFields(controller: _fields, errors: _errors),
        SwitchListTile(contentPadding: EdgeInsets.zero, value: _default, onChanged: (v) => setState(() => _default = v), title: const Text('Use this address first at checkout', style: Type.body)),
        const SizedBox(height: 16),
        BusyButton(label: 'Save address', busy: _busy, onPressed: _save),
      ]),
    );
  }
}

class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key});

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  Future<List<ProductSummary>>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= _fetch();
  }

  Future<List<ProductSummary>> _fetch() async {
    final state = AppScope.read(context);
    final r = await state.api.get('/v1/wishlist', {'currency': state.currency});
    return ((r['items'] as List?) ?? const []).whereType<Map>().map((m) => ProductSummary({...m.cast<String, dynamic>(), 'currency': m['currency'] ?? state.currency})).toList();
  }

  @override
  Widget build(BuildContext context) {
    final saved = AppScope.of(context).wishlist;
    return Scaffold(
      appBar: AppBar(title: const Text('Wishlist')),
      body: FutureBuilder<List<ProductSummary>>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, () => setState(() => _load = _fetch()));
          if (!snap.hasData) return const Loading();
          final list = snap.data!.where((p) => saved.contains(p.id)).toList();
          if (list.isEmpty) return const StateMessage(icon: Icons.favorite_border, title: 'Nothing saved yet', body: 'Tap the heart on any product to keep it here.');
          return ProductGrid(products: list, shrinkWrap: false, onTap: (p) => Navigator.of(context).pushNamed('/product', arguments: p.slug));
        },
      ),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Future<List<AppNotification>>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= _fetch();
  }

  Future<List<AppNotification>> _fetch() async {
    final state = AppScope.read(context);
    final r = await state.api.get('/v1/notifications');
    final list = ((r['notifications'] as List?) ?? const []).whereType<Map>().map((m) => AppNotification(m.cast<String, dynamic>())).toList();
    if (list.any((n) => !n.read)) {
      try {
        await state.api.post('/v1/notifications/read', {'all': true});
        state.markAllRead();
      } on ApiError {
        // Marked next time.
      }
    }
    return list;
  }

  void _open(AppNotification n) {
    final m = RegExp(r'/account/orders/([a-z0-9-]+)/?', caseSensitive: false).firstMatch(n.link ?? '');
    if (m != null) Navigator.of(context).pushNamed('/order', arguments: m.group(1)!.toUpperCase());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [IconButton(tooltip: 'Notification settings', icon: const Icon(Icons.settings_outlined), onPressed: () => Navigator.of(context).pushNamed('/notification-settings'))]),
      body: FutureBuilder<List<AppNotification>>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, () => setState(() => _load = _fetch()));
          if (!snap.hasData) return const Loading();
          final list = snap.data!;
          if (list.isEmpty) return const StateMessage(icon: Icons.notifications_none, title: 'No notifications yet', body: 'Order updates and back-in-stock alerts appear here.');
          return ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: Brand.gutter),
            itemCount: list.length,
            separatorBuilder: (_, __) => const Divider(),
            itemBuilder: (_, i) {
              final n = list[i];
              return ListTile(
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
                leading: n.read ? null : const Icon(Icons.circle, size: 10, color: Brand.gold, semanticLabel: 'New'),
                title: Text(n.title, style: Type.strong),
                subtitle: Text('${n.body}\n${shortDate(n.createdAt)}', style: Type.small),
                onTap: n.link == null ? null : () => _open(n),
              );
            },
          );
        },
      ),
    );
  }
}

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  Map<String, bool>? _prefs;
  Object? _error;

  static const _rows = <(String, String, String)>[
    ('Order updates', 'ordersEmail', 'ordersPush'),
    ('Back in stock', 'backInStockEmail', 'backInStockPush'),
    ('Offers and new arrivals', 'offersEmail', 'offersPush'),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.get('/v1/account/notifications');
      setState(() => _prefs = ((r['preferences'] as Map?) ?? const {}).map((k, v) => MapEntry('$k', v == true)));
    } on ApiError catch (e) {
      setState(() => _error = e);
    }
  }

  Future<void> _set(String key, bool value) async {
    final before = Map<String, bool>.of(_prefs!);
    setState(() => _prefs![key] = value);
    try {
      await AppScope.read(context).api.post('/v1/account/notifications', {key: value});
    } on ApiError catch (e) {
      setState(() => _prefs = before);
      if (mounted) showMessage(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _prefs;
    return Scaffold(
      appBar: AppBar(title: const Text('Notification settings')),
      body: _error != null
          ? StateMessage.error(_error!, () {
              setState(() => _error = null);
              _load();
            })
          : p == null
              ? const Loading()
              : ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
                  const Text('Order emails about payments and refunds are always sent.', style: Type.small),
                  for (final (label, email, push) in _rows) ...[
                    SectionHead(label),
                    SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Email', style: Type.body), value: p[email] ?? false, onChanged: (v) => _set(email, v)),
                    SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('On this phone', style: Type.body), value: p[push] ?? false, onChanged: (v) => _set(push, v)),
                  ],
                ]),
    );
  }
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    Future<void> page(String path) => launchUrl(Uri.parse('${AppConfig.siteBase}$path'), mode: LaunchMode.inAppBrowserView);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), children: [
        const SectionHead('Currency'),
        if (state.currencies.isEmpty)
          Text(state.currency, style: Type.body)
        else
          RadioGroup<String>(
            groupValue: state.currency,
            onChanged: (v) {
              if (v != null) state.setCurrency(v);
            },
            child: Column(children: [
              for (final c in state.currencies) RadioListTile<String>(contentPadding: EdgeInsets.zero, value: c.code, title: Text('${c.name} (${c.symbol})', style: Type.body)),
            ]),
          ),
        const Text('Naira is paid with Paystack; dollars, pounds and euros by card with Stripe.', style: Type.small),
        const SectionHead('About'),
        LinkRow('Delivery', onTap: () => page('/shipping/')),
        LinkRow('Returns', onTap: () => page('/returns/')),
        LinkRow('Privacy', onTap: () => page('/privacy/')),
        LinkRow('Terms', onTap: () => page('/terms/')),
        if (state.signedIn) LinkRow('Notification settings', onTap: () => Navigator.of(context).pushNamed('/notification-settings')),
        const SizedBox(height: 24),
        const Text('hairbydemj for iPhone and Android', style: Type.small),
        const SizedBox(height: 24),
      ]),
    );
  }
}

/// Used where a summary of money is shown in a list.
String orderLine(OrderSummary o) => '${shortDate(o.placedAt)} · ${o.itemCount} ${o.itemCount == 1 ? 'item' : 'items'} · ${money(o.totalMinor, o.currency)}';
