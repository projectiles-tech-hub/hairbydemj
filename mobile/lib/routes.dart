import 'package:flutter/material.dart';

import 'api/models.dart';
import 'screens/account.dart';
import 'screens/auth.dart';
import 'screens/checkout.dart';
import 'screens/info.dart';
import 'screens/orders.dart';
import 'screens/product.dart';
import 'screens/product_list.dart';
import 'screens/search.dart';

/// Every screen the app can open by name, with what it needs.
Route<dynamic>? onGenerateRoute(RouteSettings settings) {
  final args = settings.arguments;
  Widget? screen = switch (settings.name) {
    '/product' => ProductScreen(slug: args as String),
    '/list' => ProductListScreen(listing: args as Listing),
    '/search' => const SearchScreen(),
    '/sign-in' => const SignInScreen(),
    '/sign-up' => const SignUpScreen(),
    '/verify' => VerifyScreen(email: args as String),
    '/forgot' => const ForgotPasswordScreen(),
    '/checkout' => const CheckoutScreen(),
    '/complete' => OrderCompleteScreen(number: args as String),
    '/orders' => const OrdersScreen(),
    '/order' => OrderScreen(number: args as String),
    '/return' => ReturnRequestScreen(order: args as Order),
    '/addresses' => const AddressesScreen(),
    '/address' => AddressFormScreen(address: args as Address?),
    '/profile' => const ProfileScreen(),
    '/password' => const ChangePasswordScreen(),
    '/delete-account' => const DeleteAccountScreen(),
    '/wishlist' => const WishlistScreen(),
    '/notifications' => const NotificationsScreen(),
    '/notification-settings' => const NotificationSettingsScreen(),
    '/settings' => const SettingsScreen(),
    '/help' => const HelpScreen(),
    _ => null,
  };
  if (screen == null) return null;
  return MaterialPageRoute<dynamic>(builder: (_) => screen, settings: settings);
}
