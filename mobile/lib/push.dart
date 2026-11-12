import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'api/client.dart';
import 'api/store.dart';
import 'config.dart';
import 'state/app_state.dart';
import 'theme.dart';

/// Push notifications. The server sends to iPhones through Apple (APNs) and to
/// Android phones through Google (Firebase Cloud Messaging); see
/// docs/notifications.md. Off until the Firebase settings are given when
/// building (docs/app.md).
class Push {
  Push._();
  static final instance = Push._();
  static final navigatorKey = GlobalKey<NavigatorState>();

  AppState? _state;
  String? _token;
  bool _started = false;

  Future<void> start(AppState state) async {
    _state = state;
    if (!AppConfig.pushEnabled || _started) return;
    _started = true;
    try {
      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: AppConfig.firebaseApiKey,
          appId: Platform.isIOS ? AppConfig.firebaseIosAppId : AppConfig.firebaseAndroidAppId,
          messagingSenderId: AppConfig.firebaseSenderId,
          projectId: AppConfig.firebaseProjectId,
        ),
      );
    } on Exception {
      return;
    }
    FirebaseMessaging.onMessage.listen(_shown);
    FirebaseMessaging.onMessageOpenedApp.listen(_opened);
    final first = await FirebaseMessaging.instance.getInitialMessage();
    if (first != null) _opened(first);
    FirebaseMessaging.instance.onTokenRefresh.listen((_) => register());
    state.addListener(_signedInChanged);
    // Ask once, the first time someone is signed in (the designs' "Notifications" ask screen).
    _signedInChanged();
  }

  bool _wasSignedIn = false;

  void _signedInChanged() {
    final signedIn = _state?.signedIn ?? false;
    if (signedIn && !_wasSignedIn) unawaited(_askThenRegister());
    if (!signedIn && _wasSignedIn) _token = null;
    _wasSignedIn = signedIn;
  }

  Future<void> _askThenRegister() async {
    final store = _state!.api.store;
    if (await store.read(TokenStore.pushAsked) != '1') {
      final context = navigatorKey.currentContext;
      if (context == null || !context.mounted) return;
      final yes = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Know when your order moves'),
          content: const Text('We send a notification when your order is paid, shipped and delivered, and when saved items are back in stock. You can change this any time in Settings.', style: Type.body),
          actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Not now')), TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Turn on'))],
        ),
      );
      await store.write(TokenStore.pushAsked, '1');
      if (yes != true) return;
    }
    await register();
  }

  /// Ask the phone for permission and give the shop this phone's address.
  Future<void> register() async {
    final state = _state;
    if (state == null || !state.signedIn || !AppConfig.pushEnabled) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      // iPhones are sent to straight through Apple, so the server needs the APNs token.
      final token = Platform.isIOS ? await FirebaseMessaging.instance.getAPNSToken() : await FirebaseMessaging.instance.getToken();
      if (token == null || token == _token) return;
      await state.api.post('/v1/push/devices', {'token': token, 'platform': Platform.isIOS ? 'ios' : 'android'});
      _token = token;
    } on ApiError {
      // Tried again next launch.
    } on Exception {
      // No permission or no network.
    }
  }

  void _shown(RemoteMessage m) {
    _state?.refreshUnread();
    final context = navigatorKey.currentContext;
    final n = m.notification;
    if (context == null || n == null) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text([n.title, n.body].whereType<String>().join(': '))));
  }

  void _opened(RemoteMessage m) {
    final link = '${m.data['link'] ?? ''}';
    final order = RegExp(r'/account/orders/([a-z0-9-]+)/?', caseSensitive: false).firstMatch(link);
    if (order != null) navigatorKey.currentState?.pushNamed('/order', arguments: order.group(1)!.toUpperCase());
    _state?.refreshUnread();
  }
}
