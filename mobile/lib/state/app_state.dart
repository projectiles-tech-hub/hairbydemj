import 'package:flutter/widgets.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/store.dart';

/// What the whole app shares: who is signed in, the bag, the currency, the
/// saved items and unread notifications. Screens listen with AppScope.of().
class AppState extends ChangeNotifier {
  AppState(this.api) {
    api.onSignedOut = () {
      customer = null;
      wishlist = {};
      unread = 0;
      notifyListeners();
    };
  }

  final ApiClient api;

  Customer? customer;
  Cart cart = Cart.empty();
  String currency = 'NGN';
  List<CurrencyInfo> currencies = [];
  Set<int> wishlist = {};
  int unread = 0;
  bool onboarded = true;
  bool ready = false;

  bool get signedIn => customer != null;

  /// Run once when the app opens.
  Future<void> start() async {
    onboarded = await api.store.read(TokenStore.onboarded) == '1';
    final saved = await api.store.read(TokenStore.currency);
    try {
      final c = await api.get('/v1/currency');
      currencies = ((c['currencies'] as List?) ?? const []).whereType<Map>().map((m) => CurrencyInfo(m.cast<String, dynamic>())).toList();
      currency = saved ?? '${c['current'] ?? 'NGN'}';
    } on ApiError {
      currency = saved ?? 'NGN';
    }
    if (await api.store.read(TokenStore.session) != null) {
      try {
        customer = Customer((await api.get('/v1/auth/me'))['customer'] as Json);
      } on ApiError catch (e) {
        if (!e.offline) await api.store.delete(TokenStore.session);
      }
    }
    await refreshCart();
    if (signedIn) {
      await Future.wait([refreshWishlist(), refreshUnread()]);
    }
    ready = true;
    notifyListeners();
  }

  Future<void> finishOnboarding() async {
    onboarded = true;
    await api.store.write(TokenStore.onboarded, '1');
    notifyListeners();
  }

  // ----- signing in -----

  /// The server's reply to signing in: {customer, token}.
  Future<void> signedInWith(Json reply) async {
    await api.store.write(TokenStore.session, '${reply['token']}');
    customer = Customer(reply['customer'] as Json);
    notifyListeners();
    // A guest bag joins the account's bag on the next read.
    await Future.wait([refreshCart(), refreshWishlist(), refreshUnread()]);
  }

  Future<void> signOut() async {
    try {
      await api.post('/v1/auth/sign-out');
    } on ApiError {
      // Signed out on this phone either way.
    }
    await api.store.delete(TokenStore.session);
    await api.store.delete(TokenStore.cart);
    customer = null;
    wishlist = {};
    unread = 0;
    cart = Cart.empty(currency);
    notifyListeners();
  }

  // ----- the bag -----

  void _setCart(Json reply) {
    final c = reply['cart'];
    if (c is Map) cart = Cart(c.cast<String, dynamic>());
    notifyListeners();
  }

  Future<void> refreshCart() async {
    try {
      _setCart(await api.get('/v1/cart', {'currency': currency}));
    } on ApiError {
      // Keep what is shown; the bag screen offers to try again.
    }
  }

  Future<void> addToCart(int variantId, int quantity) async => _setCart(await api.post('/v1/cart/items', {'variantId': variantId, 'quantity': quantity}));
  Future<void> setQuantity(int lineId, int quantity) async => _setCart(await api.post('/v1/cart/items/$lineId', {'quantity': quantity}));
  Future<void> removeLine(int lineId) async => _setCart(await api.post('/v1/cart/items/$lineId/delete'));
  Future<void> applyCode(String code) async => _setCart(await api.post('/v1/cart/discount', {'code': code}));
  Future<void> removeCode() async => _setCart(await api.post('/v1/cart/discount/delete'));
  Future<void> addGiftCard(String code) async => _setCart(await api.post('/v1/cart/gift-cards', {'code': code}));
  Future<void> removeGiftCard(int id) async => _setCart(await api.post('/v1/cart/gift-cards/$id/delete'));

  Future<void> setCurrency(String code) async {
    currency = code;
    await api.store.write(TokenStore.currency, code);
    notifyListeners();
    try {
      _setCart(await api.post('/v1/cart/currency', {'currency': code}));
    } on ApiError {
      await refreshCart();
    }
  }

  /// After an order is placed the server empties the bag.
  void cartEmptied() {
    cart = Cart.empty(currency);
    notifyListeners();
  }

  // ----- saved items -----

  Future<void> refreshWishlist() async {
    if (!signedIn) return;
    try {
      final r = await api.get('/v1/wishlist', {'currency': currency});
      wishlist = ((r['items'] as List?) ?? const []).whereType<Map>().map((m) => (m['productId'] as num).toInt()).toSet();
      notifyListeners();
    } on ApiError {
      // Shown as not saved.
    }
  }

  Future<void> toggleWishlist(int productId) async {
    final saved = wishlist.contains(productId);
    wishlist = {...wishlist}..removeWhere((id) => id == productId);
    if (!saved) wishlist.add(productId);
    notifyListeners();
    try {
      await api.post(saved ? '/v1/wishlist/$productId/delete' : '/v1/wishlist', saved ? null : {'productId': productId});
    } on ApiError {
      await refreshWishlist();
      rethrow;
    }
  }

  // ----- notifications -----

  Future<void> refreshUnread() async {
    if (!signedIn) return;
    try {
      unread = (((await api.get('/v1/notifications'))['unread']) as num?)?.toInt() ?? 0;
      notifyListeners();
    } on ApiError {
      // Leave the count as it was.
    }
  }

  void markAllRead() {
    unread = 0;
    notifyListeners();
  }
}

/// Makes the AppState available to every screen and rebuilds them when it changes.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  /// Without listening: for button handlers.
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
