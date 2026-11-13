import 'package:flutter_test/flutter_test.dart';
import 'package:hairbydemj/screens/try_on.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  test('the wig picture is moved, sized and turned so its temples land on the face', () {
    final picture = TryOnPicture({
      'colour': null,
      'path': 'p/1/tryon-abc',
      'width': 1000,
      'height': 1200,
      'temples': {'leftX': 0.3, 'leftY': 0.42, 'rightX': 0.7, 'rightY': 0.42},
    });
    const left = Offset(100, 200);
    const right = Offset(180, 220);
    final m = wigTransform(picture, left, right);
    Offset apply(Offset p) => MatrixUtils.transformPoint(m, p);

    final a = apply(const Offset(300, 504));
    final b = apply(const Offset(700, 504));
    expect(a.dx, closeTo(left.dx, 0.001));
    expect(a.dy, closeTo(left.dy, 0.001));
    expect(b.dx, closeTo(right.dx, 0.001));
    expect(b.dy, closeTo(right.dy, 0.001));
  });
}
