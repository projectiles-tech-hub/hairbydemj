import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hairbydemj/api/client.dart';
import 'package:hairbydemj/api/models.dart';
import 'package:hairbydemj/api/store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('sends the sign-in and bag tokens, and keeps a new bag token', () async {
    final store = MemoryTokenStore()..values[TokenStore.session] = 's' * 43;
    late http.Request seen;
    final api = ApiClient(
      store: store,
      base: 'https://api.example.test',
      client: MockClient((req) async {
        seen = req;
        return http.Response(jsonEncode({'cart': {'currency': 'NGN', 'lines': []}, 'cartToken': 'c' * 43}), 201, headers: {'content-type': 'application/json'});
      }),
    );
    await api.post('/v1/cart/items', {'variantId': 1, 'quantity': 1});
    expect(seen.headers['Authorization'], 'Bearer ${'s' * 43}');
    expect(seen.headers['Content-Type'], startsWith('application/json'));
    expect(jsonDecode(seen.body), {'variantId': 1, 'quantity': 1});
    expect(store.values[TokenStore.cart], 'c' * 43);

    await api.get('/v1/cart', {'currency': 'NGN', 'empty': null});
    expect(seen.headers['X-Cart-Token'], 'c' * 43);
    expect(seen.url.toString(), 'https://api.example.test/v1/cart?currency=NGN');
  });

  test('turns the server\'s error into an ApiError with field messages', () async {
    final api = ApiClient(
      store: MemoryTokenStore(),
      base: 'https://api.example.test',
      client: MockClient((_) async => http.Response(jsonEncode({'error': {'status': 422, 'code': 'invalid', 'message': 'Check the details and try again.', 'fields': {'email': 'Enter a valid email address.'}}}), 422)),
    );
    try {
      await api.post('/v1/auth/sign-in', {'email': 'x'});
      fail('should have thrown');
    } on ApiError catch (e) {
      expect(e.status, 422);
      expect(e.code, 'invalid');
      expect(e.fields['email'], 'Enter a valid email address.');
    }
  });

  test('a 401 forgets the sign-in and tells the app', () async {
    final store = MemoryTokenStore()..values[TokenStore.session] = 't' * 43;
    var told = false;
    final api = ApiClient(store: store, base: 'https://api.example.test', client: MockClient((_) async => http.Response('{"error":{"status":401,"code":"signed_out","message":"Sign in again."}}', 401)))..onSignedOut = () => told = true;
    await expectLater(api.get('/v1/auth/me'), throwsA(isA<ApiError>()));
    expect(store.values.containsKey(TokenStore.session), isFalse);
    expect(told, isTrue);
  });

  test('no network is reported as offline', () async {
    final api = ApiClient(store: MemoryTokenStore(), base: 'https://api.example.test', client: MockClient((_) async => throw http.ClientException('no route')));
    try {
      await api.get('/v1/catalog/categories');
      fail('should have thrown');
    } on ApiError catch (e) {
      expect(e.offline, isTrue);
    }
  });

  test('picks the smallest photo size that is wide enough', () {
    final api = ApiClient(store: MemoryTokenStore(), base: 'https://api.example.test', client: MockClient((_) async => http.Response('{}', 200)));
    expect(api.imageUrl({'path': 'p/1/abc', 'widths': [1080, 320, 640]}, want: 400), 'https://api.example.test/media/p/1/abc/640.jpg');
    expect(api.imageUrl({'path': 'p/1/abc', 'widths': [320]}, want: 1080), 'https://api.example.test/media/p/1/abc/320.jpg');
    expect(api.imageUrl(null), isNull);
  });

  test('reads a product and its variants from the server\'s JSON', () {
    final p = Product({
      'id': 6,
      'slug': 'deep-wave-frontal-wig',
      'name': 'Deep wave frontal wig',
      'currency': 'NGN',
      'media': [],
      'variants': [
        {'id': 13, 'sku': 'DW-18', 'lengthInches': 18, 'densityPercent': 180, 'colour': 'Natural black', 'laceType': 'HD lace', 'priceMinor': 25500000, 'available': 3, 'lowStock': true},
      ],
    });
    expect(p.variants.single.description, '18" · 180% · HD lace · Natural black');
    expect(p.variants.single.lowStock, isTrue);
  });
}
