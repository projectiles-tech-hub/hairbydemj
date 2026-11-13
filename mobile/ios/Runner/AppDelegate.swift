import ARKit
import AVFoundation
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "HairByDemjTryOn") {
      TryOn.register(with: registrar)
    }
  }
}

// MARK: - Try-on (module 16)
//
// ARKit face tracking on iPhones with a TrueDepth camera. The camera picture
// stays on the phone; Flutter only receives where the two temples are on
// screen, and draws the wig there (lib/screens/try_on.dart).

final class TryOn: NSObject, FlutterStreamHandler {
  static let shared = TryOn()
  var sink: FlutterEventSink?
  weak var view: TryOnView?

  static func register(with registrar: FlutterPluginRegistrar) {
    registrar.register(TryOnViewFactory(), withId: "hairbydemj/try-on-view")
    FlutterEventChannel(name: "hairbydemj/try-on-faces", binaryMessenger: registrar.messenger()).setStreamHandler(shared)
    let methods = FlutterMethodChannel(name: "hairbydemj/try-on", binaryMessenger: registrar.messenger())
    methods.setMethodCallHandler { call, result in shared.handle(call, result) }
  }

  func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    switch call.method {
    case "availability":
      result(ARFaceTrackingConfiguration.isSupported ? "ready" : "unsupported")
    case "cameraPermission":
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: result("granted")
      case .denied, .restricted: result("denied")
      default: result("unknown")
      }
    case "requestCamera":
      AVCaptureDevice.requestAccess(for: .video) { granted in DispatchQueue.main.async { result(granted) } }
    case "openSettings":
      if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
      result(nil)
    case "snapshot":
      guard let png = view?.snapshot() else { result(nil); return }
      result(FlutterStandardTypedData(bytes: png))
    case "savePhoto":
      guard let data = call.arguments as? FlutterStandardTypedData, let image = UIImage(data: data.data) else { result(false); return }
      PhotoSaver.save(image) { ok in result(ok) }
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    sink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    sink = nil
    return nil
  }
}

final class TryOnViewFactory: NSObject, FlutterPlatformViewFactory {
  func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
    return TryOnView(frame: frame)
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    return FlutterStandardMessageCodec.sharedInstance()
  }
}

final class TryOnView: NSObject, FlutterPlatformView, ARSCNViewDelegate {
  private let scene: ARSCNView

  // Where the temples sit on a face, in ARKit's face space (metres; +x is the
  // wearer's left). Matches the try-on template (docs/try-on.md).
  private let templeA = SCNVector3(0.068, 0.032, -0.012)
  private let templeB = SCNVector3(-0.068, 0.032, -0.012)

  init(frame: CGRect) {
    scene = ARSCNView(frame: frame)
    super.init()
    scene.delegate = self
    scene.automaticallyUpdatesLighting = true
    scene.backgroundColor = .black
    TryOn.shared.view = self
    if ARFaceTrackingConfiguration.isSupported {
      let config = ARFaceTrackingConfiguration()
      config.maximumNumberOfTrackedFaces = 1
      scene.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }
  }

  deinit {
    scene.session.pause()
  }

  func view() -> UIView {
    return scene
  }

  func snapshot() -> Data? {
    return scene.snapshot().pngData()
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    guard let face = anchor as? ARFaceAnchor else { return }
    let a = node.convertPosition(templeA, to: nil)
    let b = node.convertPosition(templeB, to: nil)
    let tracked = face.isTracked
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      guard tracked else {
        TryOn.shared.sink?(["found": false])
        return
      }
      let p = self.scene.projectPoint(a)
      let q = self.scene.projectPoint(b)
      TryOn.shared.sink?(["found": true, "ax": Double(p.x), "ay": Double(p.y), "bx": Double(q.x), "by": Double(q.y)])
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
    DispatchQueue.main.async { TryOn.shared.sink?(["found": false]) }
  }
}

/// Saves a picture to Photos (asks for "add only" permission the first time).
final class PhotoSaver: NSObject {
  private static var pending: [PhotoSaver] = []
  private let done: (Bool) -> Void

  private init(done: @escaping (Bool) -> Void) {
    self.done = done
  }

  static func save(_ image: UIImage, done: @escaping (Bool) -> Void) {
    let saver = PhotoSaver(done: done)
    pending.append(saver)
    UIImageWriteToSavedPhotosAlbum(image, saver, #selector(finished(_:didFinishSavingWithError:contextInfo:)), nil)
  }

  @objc private func finished(_ image: UIImage, didFinishSavingWithError error: Error?, contextInfo: UnsafeRawPointer) {
    done(error == nil)
    PhotoSaver.pending.removeAll { $0 === self }
  }
}
