import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Help: live chat, WhatsApp, and the website's help pages.
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    Future<void> page(String path) => launchUrl(Uri.parse('${AppConfig.siteBase}$path'), mode: LaunchMode.inAppBrowserView);
    final whatsapp = AppConfig.whatsapp.replaceAll(RegExp(r'[^0-9]'), '');
    return Scaffold(
      appBar: AppBar(title: const Text('Help and contact')),
      body: ListView(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), children: [
        const Padding(padding: EdgeInsets.only(bottom: 16), child: Text('We answer every day, usually within a few hours.', style: Type.body)),
        BusyButton(label: 'Chat with us', onPressed: () => Navigator.of(context).pushNamed('/chat')),
        const SizedBox(height: 12),
        if (whatsapp.isNotEmpty) BusyButton(label: 'Message us on WhatsApp', outlined: true, onPressed: () => launchUrl(Uri.parse('https://wa.me/$whatsapp'), mode: LaunchMode.externalApplication)),
        const SizedBox(height: 16),
        LinkRow('Contact us', onTap: () => page('/contact/')),
        LinkRow('Questions and answers', onTap: () => page('/faq/')),
        LinkRow('Length and density guide', onTap: () => page('/guides/length-and-density/')),
        LinkRow('Delivery', onTap: () => page('/shipping/')),
        LinkRow('Returns', onTap: () => page('/returns/')),
      ]),
    );
  }
}
