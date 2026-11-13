import 'package:flutter_test/flutter_test.dart';
import 'package:hairbydemj/util/money.dart';

void main() {
  test('money shows the symbol, groups thousands and drops .00', () {
    expect(money(28500000, 'NGN'), '₦285,000');
    expect(money(4999, 'USD'), r'$49.99');
    expect(money(100, 'GBP'), '£1');
    expect(money(-150050, 'EUR'), '-€1,500.50');
    expect(money(5, 'USD'), r'$0.05');
  });

  test('order statuses read as the website says them', () {
    expect(orderStatusWords('on_hold'), 'Waiting for payment');
    expect(orderStatusWords('shipped'), 'On its way');
  });
}
