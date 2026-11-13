import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hairbydemj/api/client.dart';
import 'package:hairbydemj/api/store.dart';
import 'package:hairbydemj/screens/cart.dart';
import 'package:hairbydemj/screens/onboarding.dart';
import 'package:hairbydemj/state/app_state.dart';
import 'package:hairbydemj/theme.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A fake shop that answers like the real server.
ApiClient fakeShop(Map<String, Object> replies) => ApiClient(
      store: MemoryTokenStore(),
      base: 'https://api.example.test',
      client: MockClient((req) async {
        final body = replies['${req.method} ${req.url.path}'];
        if (body == null) return http.Response('{"error":{"status":404,"code":"not_found","message":"Not found"}}', 404);
        return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }),
    );

Widget wrap(AppState state, Widget child) => AppScope(state: state, child: MaterialApp(theme: buildTheme(), home: child));

void main() {
  testWidgets('an empty bag says so and offers the shop', (tester) async {
    final state = AppState(fakeShop({'GET /v1/cart': {'cart': {'currency': 'NGN', 'lines': [], 'itemCount': 0}}}));
    await tester.pumpWidget(wrap(state, const CartScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Your bag is empty'), findsOneWidget);
    expect(find.text('Start shopping'), findsOneWidget);
  });

  testWidgets('the bag lists items with prices and the total', (tester) async {
    final cart = {
      'currency': 'NGN',
      'lines': [
        {'id': 1, 'variantId': 13, 'slug': 'body-wave', 'name': 'Body wave bundles', 'description': '22" · 180% · Natural black', 'quantity': 1, 'unitMinor': 28500000, 'lineMinor': 28500000, 'available': 4, 'problem': null},
      ],
      'itemCount': 1,
      'subtotalMinor': 28500000,
      'totalMinor': 28500000,
      'canCheckout': true,
    };
    final state = AppState(fakeShop({'GET /v1/cart': {'cart': cart}}));
    await state.refreshCart();
    await tester.pumpWidget(wrap(state, const CartScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Your bag (1)'), findsOneWidget);
    expect(find.text('Body wave bundles'), findsOneWidget);
    expect(find.text('₦285,000'), findsWidgets);
    expect(find.text('Checkout'), findsOneWidget);
  });

  testWidgets('onboarding moves through three slides and finishes', (tester) async {
    final state = AppState(fakeShop({}))..onboarded = false;
    await tester.pumpWidget(wrap(state, const Onboarding()));
    expect(find.text('Hair that moves the way you do'), findsOneWidget);
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('Start shopping'), findsOneWidget);
    await tester.tap(find.text('Start shopping'));
    await tester.pumpAndSettle();
    expect(state.onboarded, isTrue);
  });
}
