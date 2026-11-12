import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import '../util/places.dart';
import 'common.dart';

/// The address form used at checkout and in the account.
class AddressFields extends StatefulWidget {
  const AddressFields({super.key, required this.controller, this.errors = const {}});

  final AddressController controller;
  final Map<String, String> errors;

  @override
  State<AddressFields> createState() => _AddressFieldsState();
}

class AddressController {
  AddressController([Address? a])
      : name = TextEditingController(text: a?.name),
        phone = TextEditingController(text: a?.phone),
        line1 = TextEditingController(text: a?.line1),
        line2 = TextEditingController(text: a?.line2),
        city = TextEditingController(text: a?.city),
        region = TextEditingController(text: a?.region),
        postalCode = TextEditingController(text: a?.postalCode),
        country = a?.country ?? 'NG';

  final TextEditingController name, phone, line1, line2, city, region, postalCode;
  String country;

  Address value({String label = '', bool isDefault = false, int? id}) => Address(
        id: id,
        label: label,
        name: name.text.trim(),
        phone: phone.text.trim(),
        line1: line1.text.trim(),
        line2: line2.text.trim(),
        city: city.text.trim(),
        region: region.text.trim(),
        postalCode: postalCode.text.trim(),
        country: country,
        isDefault: isDefault,
      );

  void fill(Address a) {
    name.text = a.name;
    phone.text = a.phone;
    line1.text = a.line1;
    line2.text = a.line2;
    city.text = a.city;
    region.text = a.region;
    postalCode.text = a.postalCode;
    country = a.country;
  }

  void dispose() {
    for (final c in [name, phone, line1, line2, city, region, postalCode]) {
      c.dispose();
    }
  }
}

class _AddressFieldsState extends State<AddressFields> {
  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final e = widget.errors;
    String? err(String k) => e[k] ?? e['address.$k'];
    final nigeria = c.country == 'NG';
    return AutofillGroup(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        LabelledField(label: 'Full name', controller: c.name, error: err('name'), autofill: const [AutofillHints.name], textCapitalization: TextCapitalization.words),
        LabelledField(label: 'Phone (the courier calls this)', controller: c.phone, error: err('phone'), keyboardType: TextInputType.phone, autofill: const [AutofillHints.telephoneNumber]),
        const Text('Country', style: Type.strong),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          key: ValueKey('country-${c.country}'),
          initialValue: c.country,
          isExpanded: true,
          dropdownColor: Brand.espresso,
          style: Type.body,
          decoration: InputDecoration(errorText: err('country')),
          items: [for (final (code, name) in countries) DropdownMenuItem(value: code, child: Text(name, overflow: TextOverflow.ellipsis))],
          onChanged: (v) => setState(() {
            c.country = v ?? 'NG';
            c.region.clear();
          }),
        ),
        const SizedBox(height: 16),
        LabelledField(label: 'Address', controller: c.line1, error: err('line1'), autofill: const [AutofillHints.streetAddressLine1]),
        LabelledField(label: 'Address, second line (optional)', controller: c.line2, error: err('line2'), autofill: const [AutofillHints.streetAddressLine2]),
        LabelledField(label: 'City or town', controller: c.city, error: err('city'), autofill: const [AutofillHints.addressCity], textCapitalization: TextCapitalization.words),
        if (nigeria) ...[
          const Text('State', style: Type.strong),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            key: ValueKey('state-${c.region.text}'),
            initialValue: nigerianStates.contains(c.region.text) ? c.region.text : null,
            isExpanded: true,
            dropdownColor: Brand.espresso,
            style: Type.body,
            hint: const Text('Choose a state', style: Type.small),
            decoration: InputDecoration(errorText: err('region')),
            items: [for (final s in nigerianStates) DropdownMenuItem(value: s, child: Text(s))],
            onChanged: (v) => setState(() => c.region.text = v ?? ''),
          ),
          const SizedBox(height: 16),
        ] else
          LabelledField(label: 'State, county or province', controller: c.region, error: err('region'), autofill: const [AutofillHints.addressState]),
        LabelledField(label: nigeria ? 'Postcode (optional)' : 'Postcode', controller: c.postalCode, error: err('postalCode'), autofill: const [AutofillHints.postalCode], textInputAction: TextInputAction.done),
      ]),
    );
  }
}
