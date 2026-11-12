import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../tryon_channel.dart';
import '../util/money.dart';
import '../widgets/common.dart';

/// A wig that can be tried on, with its see-through pictures.
class TryOnStyle {
  TryOnStyle(Json j)
      : slug = '${j['slug']}',
        name = '${j['name']}',
        priceFromMinor = (j['priceFromMinor'] as num?)?.toInt(),
        currency = '${j['currency']}',
        images = ((j['images'] ?? j['tryOn']) as List? ?? const []).whereType<Map>().map((m) => TryOnPicture(m.cast<String, dynamic>())).toList();
  final String slug;
  final String name;
  final int? priceFromMinor;
  final String currency;
  final List<TryOnPicture> images;
}

class TryOnPicture {
  TryOnPicture(Json j)
      : colour = j['colour'] as String?,
        path = '${j['path']}',
        width = (j['width'] as num).toDouble(),
        height = (j['height'] as num).toDouble(),
        left = Offset(((j['temples'] as Map)['leftX'] as num).toDouble(), ((j['temples'] as Map)['leftY'] as num).toDouble()),
        right = Offset(((j['temples'] as Map)['rightX'] as num).toDouble(), ((j['temples'] as Map)['rightY'] as num).toDouble());
  final String? colour;
  final String path;
  final double width;
  final double height;

  /// Where the temples sit, as fractions of the picture.
  final Offset left;
  final Offset right;

  String url(String base) => '$base/media/$path/1200.png';
}

/// Where to draw a wig picture so its temples land on two points.
Matrix4 wigTransform(TryOnPicture p, Offset left, Offset right) {
  final a = Offset(p.left.dx * p.width, p.left.dy * p.height);
  final b = Offset(p.right.dx * p.width, p.right.dy * p.height);
  final scale = (right - left).distance / (b - a).distance;
  final angle = (right - left).direction - (b - a).direction;
  return Matrix4.identity()
    ..translateByDouble(left.dx, left.dy, 0, 1)
    ..rotateZ(angle)
    ..scaleByDouble(scale, scale, 1, 1)
    ..translateByDouble(-a.dx, -a.dy, 0, 1);
}

/// The Try on tab: wigs that can be tried on.
class TryOnScreen extends StatefulWidget {
  const TryOnScreen({super.key});

  @override
  State<TryOnScreen> createState() => _TryOnScreenState();
}

class _TryOnScreenState extends State<TryOnScreen> {
  Future<List<TryOnStyle>>? _load;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load ??= _fetch();
  }

  Future<List<TryOnStyle>> _fetch() async {
    final state = AppScope.read(context);
    final r = await state.api.get('/v1/catalog/try-on', {'currency': state.currency});
    return ((r['products'] as List?) ?? const []).whereType<Map>().map((m) => TryOnStyle(m.cast<String, dynamic>())).toList();
  }

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).api;
    return Scaffold(
      appBar: AppBar(title: const Text('Try on')),
      body: FutureBuilder<List<TryOnStyle>>(
        future: _load,
        builder: (context, snap) {
          if (snap.hasError) return StateMessage.error(snap.error!, () => setState(() => _load = _fetch()));
          if (!snap.hasData) return const Loading();
          final styles = snap.data!;
          if (styles.isEmpty) return const StateMessage(icon: Icons.auto_awesome_outlined, title: 'Nothing to try on yet', body: 'Wigs you can try on with your camera will appear here.');
          return GridView.builder(
            padding: const EdgeInsets.all(Brand.gutter),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 220, mainAxisSpacing: 16, crossAxisSpacing: 12, childAspectRatio: 0.7),
            itemCount: styles.length,
            itemBuilder: (_, i) {
              final s = styles[i];
              return Semantics(
                button: true,
                label: 'Try on ${s.name}',
                excludeSemantics: true,
                child: InkWell(
                  borderRadius: BorderRadius.circular(Brand.radiusCard),
                  onTap: () => Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(builder: (_) => TryOnCameraScreen(styles: styles, start: s.slug))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Container(
                        decoration: BoxDecoration(color: Brand.surfacePhoto, borderRadius: BorderRadius.circular(Brand.radiusCard)),
                        padding: const EdgeInsets.all(8),
                        child: s.images.isEmpty ? null : Image.network(s.images.first.url(api.base), fit: BoxFit.contain, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(s.name, style: Type.strong, maxLines: 2, overflow: TextOverflow.ellipsis),
                    if (s.priceFromMinor != null) Text('From ${money(s.priceFromMinor!, s.currency)}', style: Type.small),
                  ]),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

enum _Mode { checking, ask, refused, camera, photo, unsupported }

/// The try-on itself: the camera with the wig on, styles, colour, length,
/// add to bag and save photo. A photo can be used instead of the camera.
class TryOnCameraScreen extends StatefulWidget {
  const TryOnCameraScreen({super.key, required this.styles, required this.start});
  final List<TryOnStyle> styles;
  final String start;

  @override
  State<TryOnCameraScreen> createState() => _TryOnCameraScreenState();
}

class _TryOnCameraScreenState extends State<TryOnCameraScreen> with WidgetsBindingObserver {
  _Mode _mode = _Mode.checking;
  late TryOnStyle _style = widget.styles.firstWhere((s) => s.slug == widget.start, orElse: () => widget.styles.first);
  int _colour = 0;
  List<Variant> _variants = [];
  int? _variantId;
  FaceTemples? _face;
  StreamSubscription<FaceTemples?>? _faces;
  bool _adding = false;
  bool _saving = false;

  // Photo mode: the photo, and where the wig sits on it (moved by dragging and pinching).
  Uint8List? _photo;
  Offset _photoLeft = const Offset(110, 220);
  Offset _photoRight = const Offset(250, 220);
  Offset? _gestureStart;
  (Offset, Offset)? _placeStart;
  final _photoKey = GlobalKey();

  TryOnPicture? get _picture => _style.images.isEmpty ? null : _style.images[_colour.clamp(0, _style.images.length - 1)];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
    _loadVariants();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _faces?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // Back from the phone's settings, or from installing ARCore: look again.
    if (s == AppLifecycleState.resumed && (_mode == _Mode.refused || _mode == _Mode.checking)) _check();
  }

  Future<void> _check() async {
    final availability = await TryOnChannel.availability();
    if (!mounted) return;
    if (availability == 'installing') {
      setState(() => _mode = _Mode.checking);
      return;
    }
    if (availability != 'ready') {
      setState(() => _mode = _Mode.unsupported);
      return;
    }
    final permission = await TryOnChannel.cameraPermission();
    if (!mounted) return;
    if (permission == 'granted') {
      _startCamera();
    } else {
      setState(() => _mode = permission == 'denied' ? _Mode.refused : _Mode.ask);
    }
  }

  Future<void> _allow() async {
    final ok = await TryOnChannel.requestCamera();
    if (!mounted) return;
    if (ok) {
      _startCamera();
    } else {
      setState(() => _mode = _Mode.refused);
    }
  }

  void _startCamera() {
    _faces ??= TryOnChannel.faces().listen((f) {
      if (mounted) setState(() => _face = f);
    });
    setState(() => _mode = _Mode.camera);
  }

  Future<void> _pickPhoto() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    setState(() {
      _photo = bytes;
      _mode = _Mode.photo;
    });
  }

  Future<void> _loadVariants() async {
    final state = AppScope.read(context);
    try {
      final r = await state.api.get('/v1/catalog/products/${Uri.encodeComponent(_style.slug)}', {'currency': state.currency});
      final p = Product(r['product'] as Json);
      if (!mounted) return;
      setState(() {
        _variants = p.variants;
        _pickVariant();
      });
    } on ApiError {
      if (mounted) setState(() => _variants = []);
    }
  }

  List<Variant> get _usable {
    final colour = _picture?.colour?.toLowerCase();
    return _variants.where((v) => v.available > 0 && (colour == null || (v.colour ?? '').toLowerCase() == colour)).toList();
  }

  void _pickVariant() {
    final usable = _usable;
    _variantId = usable.any((v) => v.id == _variantId) ? _variantId : (usable.isEmpty ? null : usable.first.id);
  }

  void _chooseStyle(TryOnStyle s) {
    setState(() {
      _style = s;
      _colour = 0;
      _variants = [];
      _variantId = null;
    });
    _loadVariants();
  }

  Future<void> _add() async {
    final id = _variantId;
    if (id == null) return;
    setState(() => _adding = true);
    try {
      await AppScope.read(context).addToCart(id, 1);
      if (mounted) showMessage(context, 'Added to your bag.');
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  /// The picture on screen with the wig on, as PNG.
  Future<Uint8List?> _composite() async {
    final api = AppScope.read(context).api;
    final picture = _picture;
    if (picture == null) return null;
    if (_mode == _Mode.photo) {
      final boundary = _photoKey.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      final image = await boundary?.toImage(pixelRatio: 2);
      return (await image?.toByteData(format: ui.ImageByteFormat.png))?.buffer.asUint8List();
    }
    final face = _face;
    final background = await TryOnChannel.snapshot();
    if (background == null) return null;
    final bg = await _decode(background);
    final wig = await _decode(Uint8List.view((await NetworkAssetBundle(Uri.parse(api.base)).load(picture.url(api.base))).buffer));
    final viewSize = MediaQuery.sizeOf(context);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawImage(bg, Offset.zero, Paint());
    if (face != null) {
      // The snapshot is in device pixels; the face points are in screen points.
      final k = bg.width / viewSize.width;
      canvas.save();
      canvas.scale(k, k);
      canvas.transform(wigTransform(picture, face.left, face.right).storage);
      canvas.scale(picture.width / wig.width, picture.height / wig.height);
      canvas.drawImage(wig, Offset.zero, Paint()..filterQuality = FilterQuality.high);
      canvas.restore();
    }
    final out = await recorder.endRecording().toImage(bg.width, bg.height);
    return (await out.toByteData(format: ui.ImageByteFormat.png))?.buffer.asUint8List();
  }

  Future<ui.Image> _decode(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    return (await codec.getNextFrame()).image;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final png = await _composite();
      final ok = png != null && await TryOnChannel.savePhoto(png);
      if (mounted) showMessage(context, ok ? 'Saved to your photos.' : 'We could not save the photo. Allow hairbydemj to add photos in your phone settings.');
    } on PlatformException {
      if (mounted) showMessage(context, 'We could not save the photo.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _wig(TryOnPicture p, Offset left, Offset right) {
    final api = AppScope.read(context).api;
    return Positioned(
      left: 0,
      top: 0,
      child: IgnorePointer(
        child: Transform(
          transform: wigTransform(p, left, right),
          child: SizedBox(width: p.width, height: p.height, child: Image.network(p.url(api.base), fit: BoxFit.fill, gaplessPlayback: true, excludeFromSemantics: true)),
        ),
      ),
    );
  }

  Widget _stage() {
    final picture = _picture;
    switch (_mode) {
      case _Mode.checking:
        return const Loading();
      case _Mode.ask:
        return _Panel(
          title: 'See the wig on you',
          body: 'The try-on needs your camera. The picture stays on your phone; nothing is uploaded or saved unless you tap Save photo.',
          primary: ('Allow camera', _allow),
          secondary: ('Upload a photo instead', _pickPhoto),
          tertiary: ('Not now', () => Navigator.of(context).pop()),
        );
      case _Mode.refused:
        return _Panel(
          title: 'The camera is off for hairbydemj',
          body: 'To use the try-on, turn the camera on for hairbydemj in your phone settings. Or upload a photo of yourself instead.',
          primary: ('Open settings', TryOnChannel.openSettings),
          secondary: ('Upload a photo instead', _pickPhoto),
        );
      case _Mode.unsupported:
        return _Panel(
          title: 'This phone cannot use the live try-on',
          body: 'Live try-on needs a phone with face tracking (iPhone X or later, or an Android phone that supports ARCore). You can still try a wig on a photo of yourself.',
          primary: ('Upload a photo', _pickPhoto),
        );
      case _Mode.camera:
        final face = _face;
        return Stack(fit: StackFit.expand, children: [
          if (Platform.isIOS)
            const UiKitView(viewType: TryOnChannel.viewType, creationParamsCodec: StandardMessageCodec())
          else
            const AndroidView(viewType: TryOnChannel.viewType, creationParamsCodec: StandardMessageCodec()),
          if (face != null && picture != null) _wig(picture, face.left, face.right),
          if (face == null)
            const Positioned(left: 16, right: 16, bottom: 16, child: Text('Look straight at the camera.', textAlign: TextAlign.center, style: Type.strong)),
        ]);
      case _Mode.photo:
        return GestureDetector(
          onScaleStart: (d) {
            _gestureStart = d.localFocalPoint;
            _placeStart = (_photoLeft, _photoRight);
          },
          onScaleUpdate: (d) {
            final start = _placeStart;
            if (start == null || _gestureStart == null) return;
            final centre = (start.$1 + start.$2) / 2;
            final move = d.localFocalPoint - _gestureStart!;
            Offset place(Offset p) {
              final v = (p - centre) * d.scale;
              final rotated = Offset(v.dx * _cos(d.rotation) - v.dy * _sin(d.rotation), v.dx * _sin(d.rotation) + v.dy * _cos(d.rotation));
              return centre + move + rotated;
            }

            setState(() {
              _photoLeft = place(start.$1);
              _photoRight = place(start.$2);
            });
          },
          child: RepaintBoundary(
            key: _photoKey,
            child: Stack(fit: StackFit.expand, children: [
              Image.memory(_photo!, fit: BoxFit.cover),
              if (picture != null) _wig(picture, _photoLeft, _photoRight),
              const Positioned(left: 16, right: 16, bottom: 16, child: Text('Drag to move the wig, pinch to size and turn it.', textAlign: TextAlign.center, style: Type.small)),
            ]),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).api;
    final ready = _mode == _Mode.camera || _mode == _Mode.photo;
    final usable = _usable;
    return Scaffold(
      appBar: AppBar(title: Text(_style.name), actions: [
        if (ready) TextButton(onPressed: _pickPhoto, child: const Text('Use a photo')),
      ]),
      body: Column(children: [
        Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(Brand.radiusCard), child: Container(color: Brand.surfacePhoto, child: _stage()))),
        Padding(
          padding: const EdgeInsets.fromLTRB(Brand.gutter, 8, Brand.gutter, 0),
          child: Row(children: [
            if (_style.images.length > 1)
              Expanded(
                child: DropdownButton<int>(
                  value: _colour,
                  isExpanded: true,
                  dropdownColor: Brand.espresso,
                  style: Type.body,
                  items: [for (var i = 0; i < _style.images.length; i++) DropdownMenuItem(value: i, child: Text('Colour: ${_style.images[i].colour ?? 'As shown'}'))],
                  onChanged: (i) => setState(() {
                    _colour = i ?? 0;
                    _pickVariant();
                  }),
                ),
              ),
            if (usable.length > 1) ...[
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButton<int>(
                  value: _variantId,
                  isExpanded: true,
                  dropdownColor: Brand.espresso,
                  style: Type.body,
                  items: [for (final v in usable) DropdownMenuItem(value: v.id, child: Text('Length: ${v.lengthInches != null ? '${v.lengthInches}"' : 'one'}'))],
                  onChanged: (id) => setState(() => _variantId = id),
                ),
              ),
            ],
          ]),
        ),
        SizedBox(
          height: 96,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: Brand.gutter, vertical: 8),
            itemCount: widget.styles.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) {
              final s = widget.styles[i];
              final on = s.slug == _style.slug;
              return Semantics(
                selected: on,
                button: true,
                label: s.name,
                excludeSemantics: true,
                child: InkWell(
                  onTap: () => _chooseStyle(s),
                  borderRadius: BorderRadius.circular(Brand.radiusControl),
                  child: Container(
                    width: 76,
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(color: Brand.surfacePhoto, borderRadius: BorderRadius.circular(Brand.radiusControl), border: Border.all(color: on ? Brand.gold : Colors.transparent, width: 2)),
                    child: s.images.isEmpty ? null : Image.network(s.images.first.url(api.base), fit: BoxFit.contain, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                  ),
                ),
              );
            },
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 12),
            child: Row(children: [
              Expanded(child: BusyButton(label: _variants.isNotEmpty && usable.isEmpty ? 'Sold out in this colour' : 'Add to bag', busy: _adding, onPressed: _variantId == null ? null : _add)),
              const SizedBox(width: 12),
              BusyButton(label: 'Save photo', outlined: true, expand: false, busy: _saving, onPressed: ready ? _save : null),
            ]),
          ),
        ),
      ]),
    );
  }
}

double _cos(double a) => math.cos(a);
double _sin(double a) => math.sin(a);

class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.body, required this.primary, this.secondary, this.tertiary});
  final String title;
  final String body;
  final (String, VoidCallback) primary;
  final (String, VoidCallback)? secondary;
  final (String, VoidCallback)? tertiary;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(children: [
        const SizedBox(height: 24),
        const CircleAvatar(radius: 48, backgroundColor: Brand.goldSoft, child: Icon(Icons.photo_camera_outlined, color: Brand.gold, size: 36)),
        const SizedBox(height: 24),
        Text(title, style: Type.h1, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        Text(body, style: Type.body.copyWith(color: Brand.textMuted), textAlign: TextAlign.center),
        const SizedBox(height: 32),
        BusyButton(label: primary.$1, onPressed: primary.$2),
        if (secondary != null) ...[const SizedBox(height: 12), BusyButton(label: secondary!.$1, outlined: true, onPressed: secondary!.$2)],
        if (tertiary != null) TextButton(onPressed: tertiary!.$2, child: Text(tertiary!.$1)),
      ]),
    );
  }
}

/// Opens the try-on for one product (used by the product screen).
Future<void> openTryOn(BuildContext context, String slug) async {
  final state = AppScope.read(context);
  try {
    final r = await state.api.get('/v1/catalog/try-on', {'currency': state.currency});
    final styles = ((r['products'] as List?) ?? const []).whereType<Map>().map((m) => TryOnStyle(m.cast<String, dynamic>())).toList();
    if (styles.isEmpty || !context.mounted) return;
    await Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(builder: (_) => TryOnCameraScreen(styles: styles, start: slug)));
  } on ApiError catch (e) {
    if (context.mounted) showMessage(context, e.message);
  }
}
