import 'dart:async';

import 'package:flutter/services.dart';

/// The bridge to the phone's own face tracking: ARKit on iPhone, ARCore
/// Augmented Faces on Android (ios/Runner/AppDelegate.swift and
/// android/.../MainActivity.kt). The camera picture never leaves the phone.
class TryOnChannel {
  TryOnChannel._();

  static const _methods = MethodChannel('hairbydemj/try-on');
  static const _faces = EventChannel('hairbydemj/try-on-faces');

  /// The id of the native camera view, for UiKitView and AndroidView.
  static const viewType = 'hairbydemj/try-on-view';

  /// "ready", "installing" (Android is fetching ARCore), or "unsupported".
  static Future<String> availability() async {
    try {
      return await _methods.invokeMethod<String>('availability') ?? 'unsupported';
    } on PlatformException {
      return 'unsupported';
    } on MissingPluginException {
      return 'unsupported';
    }
  }

  /// "granted", "denied" (asked and refused) or "unknown" (not asked yet).
  static Future<String> cameraPermission() async => await _methods.invokeMethod<String>('cameraPermission') ?? 'unknown';

  /// Shows the phone's own camera prompt. True when allowed.
  static Future<bool> requestCamera() async => await _methods.invokeMethod<bool>('requestCamera') ?? false;

  static Future<void> openSettings() => _methods.invokeMethod<void>('openSettings');

  /// The camera picture as it is on screen now, as PNG.
  static Future<Uint8List?> snapshot() => _methods.invokeMethod<Uint8List>('snapshot');

  /// Saves a PNG to the phone's photos. Returns false when not allowed.
  static Future<bool> savePhoto(Uint8List png) async => await _methods.invokeMethod<bool>('savePhoto', png) ?? false;

  /// Where the temples are on the camera view, in logical pixels, as the face moves.
  static Stream<FaceTemples?> faces() => _faces.receiveBroadcastStream().map((e) {
        final m = (e as Map).cast<String, Object?>();
        if (m['found'] != true) return null;
        double n(String k) => (m[k] as num).toDouble();
        return FaceTemples(Offset(n('ax'), n('ay')), Offset(n('bx'), n('by')));
      });
}

/// The two temples on screen, left one first.
class FaceTemples {
  FaceTemples(Offset a, Offset b)
      : left = a.dx <= b.dx ? a : b,
        right = a.dx <= b.dx ? b : a;
  final Offset left;
  final Offset right;
}
