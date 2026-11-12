import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'store.dart';

/// An error from the server, in its own words:
/// {"error": {"status": 422, "code": "invalid", "message": "...", "fields": {...}}}
class ApiError implements Exception {
  ApiError(this.status, this.code, this.message, [this.fields = const {}]);

  final int status;
  final String code;
  final String message;
  final Map<String, String> fields;

  /// The phone could not reach the server at all.
  bool get offline => status == 0;

  @override
  String toString() => message;
}

typedef Json = Map<String, dynamic>;

/// Talks to api.hairbydemj.com. Sends the customer's sign-in token as
/// "Authorization: Bearer" and the bag's token as "X-Cart-Token".
class ApiClient {
  ApiClient({http.Client? client, TokenStore? store, String? base})
      : _http = client ?? http.Client(),
        store = store ?? SecureTokenStore(),
        base = base ?? AppConfig.apiBase;

  final http.Client _http;
  final TokenStore store;
  final String base;

  /// Called when the server says the sign-in has ended, so the app can sign out.
  void Function()? onSignedOut;

  static const _timeout = Duration(seconds: 20);

  Future<Map<String, String>> _headers({bool json = false}) async {
    final headers = <String, String>{'Accept': 'application/json'};
    if (json) headers['Content-Type'] = 'application/json';
    if (AppConfig.apiHost.isNotEmpty) headers['Host'] = AppConfig.apiHost;
    final token = await store.read(TokenStore.session);
    if (token != null) headers['Authorization'] = 'Bearer $token';
    final cart = await store.read(TokenStore.cart);
    if (cart != null) headers['X-Cart-Token'] = cart;
    return headers;
  }

  Uri uri(String path, [Map<String, String?>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && v.isNotEmpty) q[k] = v;
    });
    return Uri.parse('$base$path').replace(queryParameters: q.isEmpty ? null : q);
  }

  Future<Json> get(String path, [Map<String, String?>? query]) async {
    return _send(() async => _http.get(uri(path, query), headers: await _headers()));
  }

  Future<Json> post(String path, [Object? body]) async {
    return _send(() async => _http.post(uri(path), headers: await _headers(json: true), body: jsonEncode(body ?? const {})));
  }

  Future<Json> _send(Future<http.Response> Function() request) async {
    http.Response res;
    try {
      res = await request().timeout(_timeout);
    } on TimeoutException {
      throw ApiError(0, 'offline', 'The shop is taking too long to answer. Check your connection and try again.');
    } on http.ClientException {
      throw ApiError(0, 'offline', 'We could not reach the shop. Check your connection and try again.');
    } on Exception {
      throw ApiError(0, 'offline', 'We could not reach the shop. Check your connection and try again.');
    }
    Json body;
    try {
      final decoded = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(utf8.decode(res.bodyBytes));
      body = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } on FormatException {
      body = <String, dynamic>{};
    }
    // A new bag made for this phone comes back with its token: keep it.
    final cartToken = body['cartToken'];
    if (cartToken is String) await store.write(TokenStore.cart, cartToken);
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final e = body['error'] is Map ? (body['error'] as Map).cast<String, dynamic>() : <String, dynamic>{};
    final fields = <String, String>{};
    if (e['fields'] is Map) {
      (e['fields'] as Map).forEach((k, v) => fields['$k'] = '$v');
    }
    if (res.statusCode == 401 && await store.read(TokenStore.session) != null) {
      await store.delete(TokenStore.session);
      onSignedOut?.call();
    }
    throw ApiError(res.statusCode, '${e['code'] ?? 'error'}', '${e['message'] ?? 'Something went wrong. Please try again.'}', fields);
  }

  /// A photo's address: the server keeps sizes as /media/<path>/<width>.jpg.
  String? imageUrl(Json? picture, {int want = 640}) {
    if (picture == null) return null;
    final path = picture['path'];
    final widths = (picture['widths'] as List?)?.whereType<num>().map((n) => n.toInt()).toList() ?? const <int>[];
    if (path is! String || widths.isEmpty) return null;
    widths.sort();
    final width = widths.firstWhere((w) => w >= want, orElse: () => widths.last);
    return '$base/media/$path/$width.jpg';
  }
}
