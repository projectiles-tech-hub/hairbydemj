import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the app keeps its tokens and a few choices between launches.
abstract class TokenStore {
  static const session = 'session';
  static const cart = 'cart';
  static const chat = 'chat';
  static const currency = 'currency';
  static const onboarded = 'onboarded';
  static const pushAsked = 'push_asked';

  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// The phone's secure storage (Keychain on iPhone, encrypted on Android).
class SecureTokenStore implements TokenStore {
  SecureTokenStore() : _storage = const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  final FlutterSecureStorage _storage;
  final Map<String, String?> _cache = {};

  @override
  Future<String?> read(String key) async {
    if (_cache.containsKey(key)) return _cache[key];
    try {
      final v = await _storage.read(key: key);
      _cache[key] = v;
      return v;
    } on Exception {
      return null;
    }
  }

  @override
  Future<void> write(String key, String value) async {
    _cache[key] = value;
    try {
      await _storage.write(key: key, value: value);
    } on Exception {
      // Kept for this launch only.
    }
  }

  @override
  Future<void> delete(String key) async {
    _cache[key] = null;
    try {
      await _storage.delete(key: key);
    } on Exception {
      // Nothing to remove.
    }
  }
}

/// For tests: kept in memory.
class MemoryTokenStore implements TokenStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}
