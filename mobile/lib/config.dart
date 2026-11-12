// Settings the app is built with. They are passed when building, for example
//   flutter build apk --dart-define=API_BASE=https://api.hairbydemj.com
// and none of them is a secret (see docs/app.md for the full list).

class AppConfig {
  const AppConfig._();

  /// The shop's API. In development: http://10.0.2.2:3000 (Android
  /// emulator) or http://localhost:3000 (iOS simulator), with API_HOST set.
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://api.hairbydemj.com');

  /// Sent as the Host header when talking to a development server that
  /// serves every address from one port (for example `api.localhost`).
  static const apiHost = String.fromEnvironment('API_HOST');

  /// The website, for pages the app opens in the browser (paying by card in
  /// other currencies, information pages).
  static const siteBase = String.fromEnvironment('SITE_BASE', defaultValue: 'https://hairbydemj.com');

  /// Google sign-in: the web client ID the server checks tokens against, and
  /// the iOS client ID. Empty means the Google button is not shown.
  static const googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
  static const googleIosClientId = String.fromEnvironment('GOOGLE_IOS_CLIENT_ID');

  /// Sign in with Apple (iPhone only). Off until the Apple service is set up.
  static const appleSignIn = bool.fromEnvironment('APPLE_SIGN_IN');

  /// Firebase, for push notifications. Empty means push is off.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const firebaseAndroidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const firebaseIosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');

  /// The shop's WhatsApp number for help, with the country code.
  static const whatsapp = String.fromEnvironment('WHATSAPP', defaultValue: '');

  static bool get googleSignIn => googleServerClientId.isNotEmpty;
  static bool get pushEnabled => firebaseApiKey.isNotEmpty && firebaseProjectId.isNotEmpty && firebaseSenderId.isNotEmpty;
}
