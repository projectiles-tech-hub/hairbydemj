/// Money is kept in the smallest unit (kobo, cents), as the server sends it.
String money(int minor, String currency, {int minorUnits = 2}) {
  final symbol = switch (currency) { 'NGN' => '₦', 'USD' => r'$', 'GBP' => '£', 'EUR' => '€', _ => '$currency ' };
  final negative = minor < 0;
  final whole = minor.abs() ~/ _pow10(minorUnits);
  final part = minor.abs() % _pow10(minorUnits);
  final grouped = _group(whole);
  // Whole amounts are shown without ".00", as on the website.
  final cents = part == 0 ? '' : '.${part.toString().padLeft(minorUnits, '0')}';
  return '${negative ? '-' : ''}$symbol$grouped$cents';
}

int _pow10(int n) {
  var r = 1;
  for (var i = 0; i < n; i++) {
    r *= 10;
  }
  return r;
}

String _group(int n) {
  final s = n.toString();
  final out = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) out.write(',');
    out.write(s[i]);
  }
  return out.toString();
}

/// "13 Nov 2026" from an ISO date, in the phone's own time zone.
String shortDate(String iso) {
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}

/// Words for an order's status, as the website shows them.
String orderStatusWords(String status) => switch (status) {
      'on_hold' => 'Waiting for payment',
      'to_fulfil' => 'Being prepared',
      'shipped' => 'On its way',
      'delivered' => 'Delivered',
      'cancelled' => 'Cancelled',
      'returned' => 'Returned',
      _ => status.replaceAll('_', ' '),
    };
