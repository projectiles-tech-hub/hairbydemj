import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import 'product_list.dart';

/// Search: suggestions while typing, then the results list.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _text = TextEditingController();
  Timer? _wait;
  Json? _suggest;

  @override
  void dispose() {
    _wait?.cancel();
    _text.dispose();
    super.dispose();
  }

  void _changed(String value) {
    _wait?.cancel();
    if (value.trim().length < 2) {
      setState(() => _suggest = null);
      return;
    }
    _wait = Timer(const Duration(milliseconds: 250), () async {
      try {
        final state = AppScope.read(context);
        final r = await state.api.get('/v1/catalog/search/suggest', {'q': value.trim(), 'currency': state.currency});
        if (mounted && _text.text == value) setState(() => _suggest = r);
      } on ApiError {
        // Suggestions are a help only.
      }
    });
  }

  void _search(String words) {
    final q = words.trim();
    if (q.isEmpty) return;
    Navigator.of(context).pushReplacementNamed('/list', arguments: Listing(title: 'Results', q: q));
  }

  @override
  Widget build(BuildContext context) {
    final s = _suggest;
    List<Map> list(String k) => ((s?[k] as List?) ?? const []).whereType<Map>().toList();
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          controller: _text,
          autofocus: true,
          textInputAction: TextInputAction.search,
          onChanged: _changed,
          onSubmitted: _search,
          style: Type.body,
          decoration: const InputDecoration(hintText: 'For example: body wave 22 inch', isDense: true),
        ),
        actions: [IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: () => _search(_text.text))],
      ),
      body: ListView(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), children: [
        for (final t in (s?['terms'] as List?) ?? const [])
          ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.search, color: Brand.textMuted), title: Text('$t', style: Type.body), onTap: () => _search('$t')),
        for (final c in list('categories'))
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.category_outlined, color: Brand.textMuted),
            title: Text('${c['name']}', style: Type.body),
            onTap: () => Navigator.of(context).pushReplacementNamed('/list', arguments: Listing(title: '${c['name']}', category: '${c['slug']}')),
          ),
        for (final p in list('products'))
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${p['name']}', style: Type.body),
            subtitle: p['priceFromMinor'] is num ? Text('From ${money((p['priceFromMinor'] as num).toInt(), '${p['currency']}')}', style: Type.small) : null,
            onTap: () => Navigator.of(context).pushReplacementNamed('/product', arguments: '${p['slug']}'),
          ),
        if (s == null)
          const Padding(padding: EdgeInsets.only(top: 24), child: Text('Search by name, texture, length or colour.', style: Type.small)),
      ]),
    );
  }
}
