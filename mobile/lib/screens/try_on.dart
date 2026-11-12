import 'package:flutter/material.dart';

import '../theme.dart';
import '../widgets/common.dart';
import 'product_list.dart';

/// The Try on tab. The camera try-on itself is module 16; until then this
/// says so and leads to the wigs.
class TryOnScreen extends StatelessWidget {
  const TryOnScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Try on')),
      body: Padding(
        padding: const EdgeInsets.all(Brand.gutter),
        child: StateMessage(
          icon: Icons.auto_awesome_outlined,
          title: 'Try hair on with your camera',
          body: 'Coming soon: see a wig on yourself before you buy. In the meantime, every product shows its length, density and lace.',
          action: 'Browse wigs',
          onAction: () => Navigator.of(context).pushNamed('/list', arguments: const Listing(title: 'Wigs', category: 'wigs')),
        ),
      ),
    );
  }
}
