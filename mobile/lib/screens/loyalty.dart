import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../config.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../widgets/common.dart';

const _kindWords = {'order': 'Order', 'review': 'Review', 'birthday': 'Birthday', 'referral': 'Referral', 'redeem': 'Spent', 'refund': 'Given back', 'adjust': 'From us', 'expire': 'Expired'};

/// Points, tier, referral link and history.
class LoyaltyScreen extends StatefulWidget {
  const LoyaltyScreen({super.key});

  @override
  State<LoyaltyScreen> createState() => _LoyaltyScreenState();
}

class _LoyaltyScreenState extends State<LoyaltyScreen> {
  Future<Json>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= AppScope.read(context).api.get('/v1/account/loyalty');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Points and referrals')),
      body: FutureBuilder<Json>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, () => setState(() => _load = AppScope.read(context).api.get('/v1/account/loyalty')));
          if (!snap.hasData) return const Loading();
          final l = (snap.data!['loyalty'] as Map).cast<String, dynamic>();
          final rules = (l['rules'] as Map).cast<String, dynamic>();
          final tier = (l['tier'] as Map).cast<String, dynamic>();
          final next = (l['nextTier'] as Map?)?.cast<String, dynamic>();
          final code = '${l['referralCode']}';
          final link = '${AppConfig.siteBase}/create-account/?ref=$code';
          final history = ((l['history'] as List?) ?? const []).whereType<Map>().toList();
          return ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Brand.espresso, borderRadius: BorderRadius.circular(Brand.radiusCard)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${l['points']} points', style: Type.display),
                Text('Worth ${money((l['worthMinor'] as num).toInt(), 'NGN')} at checkout', style: Type.body),
                const SizedBox(height: 8),
                Text('${tier['name']}${'${tier['benefit']}'.isNotEmpty ? ' · ${tier['benefit']}' : ''}', style: Type.strong),
                if (next != null) Text('${next['pointsToGo']} more points this year to reach ${next['name']}.', style: Type.small),
              ]),
            ),
            const SectionHead('Invite friends'),
            Text('When a friend\'s first order is delivered, you get ${rules['referralReferrer']} points and they get ${rules['referralFriend']}.', style: Type.body),
            const SizedBox(height: 12),
            Text('Your code: $code', style: Type.strong),
            const SizedBox(height: 8),
            BusyButton(
              label: 'Copy your link',
              outlined: true,
              onPressed: () {
                Clipboard.setData(ClipboardData(text: link));
                showMessage(context, 'Link copied.');
              },
            ),
            const SectionHead('How points work'),
            Text(
              '${rules['pointsPer1000Ngn']} point for every ₦1,000 you spend, once your order is delivered.\n'
              '${rules['reviewPoints']} points for a review, ${rules['reviewWithPhotosPoints']} with photos.\n'
              '${rules['birthdayBonus']} points on your birthday.\n'
              'Each point is worth ₦${rules['nairaPerPoint']} at checkout. Use ${rules['minimumToRedeem']} or more, for up to ${rules['maxPercentOfOrder']}% of the items.',
              style: Type.body,
            ),
            const SectionHead('History'),
            if (history.isEmpty) const Text('No points yet. They arrive once an order is delivered.', style: Type.small),
            for (final h in history)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${_kindWords[h['kind']] ?? h['kind']}${h['orderNumber'] != null ? ' · ${h['orderNumber']}' : ''}', style: Type.body),
                subtitle: Text(shortDate('${h['at']}'), style: Type.small),
                trailing: Text('${(h['points'] as num) > 0 ? '+' : ''}${h['points']}', style: Type.strong),
              ),
          ]);
        },
      ),
    );
  }
}

/// Buy a gift card, or check a balance.
class GiftCardsScreen extends StatefulWidget {
  const GiftCardsScreen({super.key});

  @override
  State<GiftCardsScreen> createState() => _GiftCardsScreenState();
}

class _GiftCardsScreenState extends State<GiftCardsScreen> {
  final _amount = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _from = TextEditingController();
  final _message = TextEditingController();
  final _buyer = TextEditingController();
  final _code = TextEditingController();
  DateTime? _deliverOn;
  int? _preset;
  bool _buying = false;
  bool _checking = false;
  Map<String, String> _errors = {};
  String? _balance;

  @override
  void dispose() {
    for (final c in [_amount, _name, _email, _from, _message, _buyer, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  List<int> _presets(String currency) => currency == 'NGN' ? [25000, 50000, 100000, 200000] : [50, 100, 150, 250];

  Future<void> _buy() async {
    final state = AppScope.read(context);
    final typed = double.tryParse(_amount.text.replaceAll(RegExp(r'[^0-9.]'), ''));
    final amount = typed ?? _preset?.toDouble();
    setState(() {
      _buying = true;
      _errors = {};
    });
    try {
      final r = await state.api.post('/v1/gift-cards/buy', {
        'amountMinor': ((amount ?? 0) * 100).round(),
        'currency': state.currency,
        'recipientName': _name.text.trim(),
        'recipientEmail': _email.text.trim(),
        'fromName': _from.text.trim(),
        'message': _message.text.trim(),
        if (_deliverOn != null) 'deliverOn': '${_deliverOn!.year}-${_deliverOn!.month.toString().padLeft(2, '0')}-${_deliverOn!.day.toString().padLeft(2, '0')}',
        if (!state.signedIn) 'email': _buyer.text.trim(),
      });
      final number = '${r['number']}';
      final token = '${r['orderToken']}';
      await state.api.store.write('order:$number', token);
      // The order's page on the website takes the payment, by Paystack or Stripe.
      await launchUrl(Uri.parse('${AppConfig.siteBase}/track-order/').replace(queryParameters: {'order': number, 'token': token}), mode: LaunchMode.externalApplication);
      if (mounted) Navigator.of(context, rootNavigator: true).pushNamed('/complete', arguments: number);
    } on ApiError catch (e) {
      setState(() => _errors = e.fields.isEmpty ? {'form': e.message} : e.fields);
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  Future<void> _check() async {
    setState(() {
      _checking = true;
      _balance = null;
    });
    try {
      final c = ((await AppScope.read(context).api.post('/v1/gift-cards/balance', {'code': _code.text}))['card'] as Map).cast<String, dynamic>();
      final left = money((c['balanceMinor'] as num).toInt(), '${c['currency']}');
      setState(() => _balance = c['status'] == 'active' ? 'Card ending ${c['last4']}: $left left${c['expiresAt'] != null ? ', until ${shortDate('${c['expiresAt']}')}' : ''}.' : 'Card ending ${c['last4']}: ${c['status'] == 'expired' ? 'expired' : c['status'] == 'used_up' ? 'used up' : 'switched off'}.');
    } on ApiError catch (e) {
      setState(() => _balance = e.fields['code'] ?? e.message);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final presets = _presets(state.currency);
    _preset ??= presets[1];
    return Scaffold(
      appBar: AppBar(title: const Text('Gift cards')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        const SectionHead('Send a gift card'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in presets)
            ChoiceChip(
              label: Text(money(p * 100, state.currency)),
              selected: _amount.text.isEmpty && _preset == p,
              labelStyle: Type.body.copyWith(color: _amount.text.isEmpty && _preset == p ? Brand.noir : Brand.ivory),
              onSelected: (_) => setState(() {
                _preset = p;
                _amount.clear();
              }),
            ),
        ]),
        const SizedBox(height: 16),
        LabelledField(label: 'Or another amount (${state.currency})', controller: _amount, error: _errors['amountMinor'], keyboardType: const TextInputType.numberWithOptions(decimal: true)),
        LabelledField(label: 'Their name', controller: _name, error: _errors['recipientName'], textCapitalization: TextCapitalization.words),
        LabelledField(label: 'Their email (the card is sent here)', controller: _email, error: _errors['recipientEmail'], keyboardType: TextInputType.emailAddress),
        LabelledField(label: 'From', controller: _from, error: _errors['fromName'], textCapitalization: TextCapitalization.words),
        LabelledField(label: 'Message (optional)', controller: _message, maxLines: 3),
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(_deliverOn == null ? 'Send when paid' : 'Send on ${shortDate(_deliverOn!.toIso8601String())}', style: Type.body),
          trailing: TextButton(
            onPressed: () async {
              final now = DateTime.now();
              final d = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 365)), initialDate: _deliverOn ?? now);
              if (d != null) setState(() => _deliverOn = d);
            },
            child: const Text('Choose a day'),
          ),
        ),
        if (!state.signedIn) LabelledField(label: 'Your email (for the receipt)', controller: _buyer, error: _errors['email'], keyboardType: TextInputType.emailAddress),
        if (_errors['form'] != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_errors['form']!, style: Type.body.copyWith(color: Brand.error))),
        const Text('Gift cards work on the website and in the app, for 2 years. They cannot be returned or changed for money.', style: Type.small),
        const SizedBox(height: 12),
        BusyButton(label: 'Buy and pay', busy: _buying, onPressed: _buy),
        const SectionHead('Check a balance'),
        LabelledField(label: 'Gift card code', controller: _code, textCapitalization: TextCapitalization.characters, textInputAction: TextInputAction.done, onSubmitted: (_) => _check()),
        BusyButton(label: 'Check balance', outlined: true, busy: _checking, onPressed: _check),
        if (_balance != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_balance!, style: Type.strong)),
      ]),
    );
  }
}

/// Reviews the customer has written, and items waiting for a review.
class MyReviewsScreen extends StatefulWidget {
  const MyReviewsScreen({super.key});

  @override
  State<MyReviewsScreen> createState() => _MyReviewsScreenState();
}

class _MyReviewsScreenState extends State<MyReviewsScreen> {
  Future<Json>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= AppScope.read(context).api.get('/v1/account/reviews');
  }

  void _reload() => setState(() => _load = AppScope.read(context).api.get('/v1/account/reviews'));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reviews')),
      body: FutureBuilder<Json>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, _reload);
          if (!snap.hasData) return const Loading();
          final todo = ((snap.data!['toReview'] as List?) ?? const []).whereType<Map>().toList();
          final mine = ((snap.data!['reviews'] as List?) ?? const []).whereType<Map>().toList();
          if (todo.isEmpty && mine.isEmpty) return const StateMessage(icon: Icons.rate_review_outlined, title: 'Nothing to review yet', body: 'Items appear here once they have been delivered to you.');
          return ListView(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), children: [
            if (todo.isNotEmpty) const SectionHead('Waiting for your review'),
            for (final t in todo)
              LinkRow('${t['productName']}', subtitle: '${t['description']} · ${t['orderNumber']}', onTap: () async {
                final sent = await Navigator.of(context).pushNamed('/write-review', arguments: t.cast<String, dynamic>());
                if (sent == true) _reload();
              }),
            if (mine.isNotEmpty) const SectionHead('Your reviews'),
            for (final r in mine) ReviewTile(review: r.cast<String, dynamic>(), mine: true),
          ]);
        },
      ),
    );
  }
}

class ReviewTile extends StatelessWidget {
  const ReviewTile({super.key, required this.review, this.mine = false});
  final Json review;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final api = AppScope.read(context).api;
    final rating = (review['rating'] as num).toInt();
    final photos = ((review['photos'] as List?) ?? const []).whereType<Map>().toList();
    final status = '${review['status']}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${'★' * rating}${'☆' * (5 - rating)}', style: Type.strong.copyWith(color: Brand.gold), semanticsLabel: '$rating out of 5 stars'),
        Text('${mine ? review['productName'] : review['author']}${review['verifiedBuyer'] == true && !mine ? ' · Verified buyer' : ''} · ${shortDate('${review['createdAt']}')}${mine ? ' · ${status == 'published' ? 'Published' : status == 'waiting' ? 'Waiting to be checked' : 'Not shown'}' : ''}', style: Type.small),
        const SizedBox(height: 4),
        Text('${review['body']}', style: Type.body),
        if (photos.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(spacing: 8, children: [
              for (final p in photos)
                ClipRRect(borderRadius: BorderRadius.circular(Brand.radiusControl), child: Image.network('${api.base}/media/${p['path']}/640.jpg', width: 80, height: 80, fit: BoxFit.cover, semanticLabel: 'Photo from the review')),
            ]),
          ),
        if (review['reply'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('hairbydemj replied: ${review['reply']}', style: Type.small.copyWith(color: Brand.ivory))),
        const Divider(),
      ]),
    );
  }
}

/// Rating, words and photos for an item the customer received.
class WriteReviewScreen extends StatefulWidget {
  const WriteReviewScreen({super.key, required this.item});
  final Json item;

  @override
  State<WriteReviewScreen> createState() => _WriteReviewScreenState();
}

class _WriteReviewScreenState extends State<WriteReviewScreen> {
  int _rating = 5;
  final _body = TextEditingController();
  final List<XFile> _photos = [];
  bool _busy = false;
  Map<String, String> _errors = {};

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _addPhotos() async {
    final picked = await ImagePicker().pickMultiImage(maxWidth: 2000, maxHeight: 2000, imageQuality: 90);
    setState(() => _photos
      ..addAll(picked)
      ..removeRange(4.clamp(0, _photos.length), _photos.length));
  }

  Future<void> _send() async {
    final api = AppScope.read(context).api;
    setState(() {
      _busy = true;
      _errors = {};
    });
    try {
      final made = await api.post('/v1/reviews', {'orderItemId': widget.item['orderItemId'], 'rating': _rating, 'body': _body.text.trim()});
      final id = (made['review'] as Map)['id'];
      for (final p in _photos) {
        await api.upload('/v1/reviews/$id/photos', await p.readAsBytes(), p.mimeType ?? 'image/jpeg');
      }
      if (!mounted) return;
      showMessage(context, 'Thank you. Your review appears once we have checked it.');
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      setState(() => _errors = e.fields.isEmpty ? {'form': e.message} : e.fields);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Write a review')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        Text('${widget.item['productName']}', style: Type.h3),
        Text('${widget.item['description']}', style: Type.small),
        const SizedBox(height: 16),
        const Text('Your rating', style: Type.strong),
        Row(children: [
          for (var i = 1; i <= 5; i++)
            IconButton(
              tooltip: '$i ${i == 1 ? 'star' : 'stars'}',
              onPressed: () => setState(() => _rating = i),
              icon: Icon(i <= _rating ? Icons.star : Icons.star_border, color: Brand.gold, size: 32),
            ),
        ]),
        if (_errors['rating'] != null) Text(_errors['rating']!, style: Type.small.copyWith(color: Brand.error)),
        const SizedBox(height: 8),
        LabelledField(label: 'Your review', controller: _body, error: _errors['body'], maxLines: 5, textInputAction: TextInputAction.newline),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in _photos) Chip(label: Text(p.name, overflow: TextOverflow.ellipsis), onDeleted: () => setState(() => _photos.remove(p))),
          if (_photos.length < 4) ActionChip(avatar: const Icon(Icons.add_a_photo_outlined, size: 18), label: const Text('Add photos'), onPressed: _addPhotos),
        ]),
        const SizedBox(height: 8),
        const Text('Photos of you wearing the hair are the most helpful. Reviews are checked before they appear.', style: Type.small),
        if (_errors['form'] != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_errors['form']!, style: Type.body.copyWith(color: Brand.error))),
        const SizedBox(height: 16),
        BusyButton(label: 'Send review', busy: _busy, onPressed: _send),
      ]),
    );
  }
}

/// The reviews part of a product screen.
class ProductReviews extends StatefulWidget {
  const ProductReviews({super.key, required this.slug});
  final String slug;

  @override
  State<ProductReviews> createState() => _ProductReviewsState();
}

class _ProductReviewsState extends State<ProductReviews> {
  Future<Json>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= AppScope.read(context).api.get('/v1/catalog/products/${Uri.encodeComponent(widget.slug)}/reviews');
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Json>(
      future: _load,
      builder: (context, snap) {
        if (!snap.hasData) return const SizedBox.shrink();
        final d = snap.data!;
        final count = (d['count'] as num?)?.toInt() ?? 0;
        final reviews = ((d['reviews'] as List?) ?? const []).whereType<Map>().toList();
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionHead('Reviews'),
          if (count == 0)
            const Text('No reviews yet. Bought this? You can review it from your account once it arrives.', style: Type.small)
          else ...[
            Text('${d['average']} out of 5 · $count ${count == 1 ? 'review' : 'reviews'}', style: Type.strong),
            for (final r in reviews) ReviewTile(review: r.cast<String, dynamic>()),
          ],
        ]);
      },
    );
  }
}
