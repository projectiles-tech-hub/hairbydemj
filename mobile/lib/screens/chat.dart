import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../util/money.dart';
import '../widgets/common.dart';

/// Live chat with the shop (module 18). New messages arrive straight away
/// through the server's event stream while this screen is open.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatMessage {
  _ChatMessage(Json j)
      : id = (j['id'] as num).toInt(),
        sender = '${j['sender']}',
        staffName = j['staffName'] as String?,
        body = '${j['body']}',
        at = '${j['at']}';
  final int id;
  final String sender;
  final String? staffName;
  final String body;
  final String at;
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _messages = <_ChatMessage>[];
  final _ids = <int>{};
  final _text = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _scroll = ScrollController();
  StreamSubscription<(String, Json)>? _stream;
  bool _loading = true;
  bool _started = false;
  bool _sending = false;
  bool _staffOnline = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stream?.cancel();
    for (final c in [_text, _name, _email]) {
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // The stream stops while the app is in the background; catch up on return.
    if (s == AppLifecycleState.resumed) _load();
    if (s == AppLifecycleState.paused) {
      _stream?.cancel();
      _stream = null;
    }
  }

  void _add(Json m) {
    final msg = _ChatMessage(m);
    if (_ids.add(msg.id)) _messages.add(msg);
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final r = await api.get('/v1/chat');
      if (!mounted) return;
      setState(() {
        _staffOnline = r['staffOnline'] == true;
        final c = (r['conversation'] as Map?)?.cast<String, dynamic>();
        if (c != null) {
          _started = true;
          for (final m in (c['messages'] as List).whereType<Map>()) {
            _add(m.cast<String, dynamic>());
          }
        }
        _loading = false;
      });
      _toBottom();
      if (_started) {
        _listen();
        api.post('/v1/chat/read').catchError((_) => <String, dynamic>{});
      }
    } on ApiError catch (e) {
      if (mounted) setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  void _listen() {
    if (_stream != null) return;
    final api = AppScope.read(context).api;
    _stream = api.events('/v1/chat/events').listen(
      (e) {
        final m = (e.$2['message'] as Map?)?.cast<String, dynamic>();
        if (m == null || !mounted) return;
        setState(() => _add(m));
        _toBottom();
        if (m['sender'] == 'staff') api.post('/v1/chat/read').catchError((_) => <String, dynamic>{});
      },
      onError: (_) => _stream = null,
      onDone: () {
        _stream = null;
        // The server or network closed it: start again after a moment.
        Future.delayed(const Duration(seconds: 3), () {
          if (mounted && _started) _listen();
        });
      },
      cancelOnError: true,
    );
  }

  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    });
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty) return;
    final state = AppScope.read(context);
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final r = await state.api.post('/v1/chat/messages', {
        'body': body,
        if (!_started && !state.signedIn && _name.text.trim().isNotEmpty) 'name': _name.text.trim(),
        if (!_started && !state.signedIn && _email.text.trim().isNotEmpty) 'email': _email.text.trim(),
      });
      final c = (r['conversation'] as Map).cast<String, dynamic>();
      setState(() {
        _started = true;
        for (final m in (c['messages'] as List).whereType<Map>()) {
          _add(m.cast<String, dynamic>());
        }
        _text.clear();
      });
      _toBottom();
      _listen();
    } on ApiError catch (e) {
      setState(() => _error = e.fields.values.firstOrNull ?? e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = AppScope.of(context).signedIn;
    return Scaffold(
      appBar: AppBar(title: const Text('Chat with us')),
      body: _loading
          ? const Loading()
          : Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(Brand.gutter, 0, Brand.gutter, 8),
                child: Text(_staffOnline ? 'We are online now.' : 'Leave a message; we usually reply within a few hours.', style: Type.small),
              ),
              Expanded(
                child: ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(Brand.gutter),
                  itemCount: _messages.length,
                  itemBuilder: (_, i) {
                    final m = _messages[i];
                    final mine = m.sender == 'customer';
                    final system = m.sender == 'system';
                    return Align(
                      alignment: system ? Alignment.center : (mine ? Alignment.centerRight : Alignment.centerLeft),
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 300),
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: mine ? Brand.surfaceRaised : Colors.transparent,
                          border: mine || system ? null : Border.all(color: Brand.gold),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m.body, style: system ? Type.small : Type.body),
                          if (!system) Text('${mine ? 'You' : (m.staffName ?? 'hairbydemj')} · ${shortDate(m.at)}', style: Type.small),
                        ]),
                      ),
                    );
                  },
                ),
              ),
              if (!_started && !signedIn)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Brand.gutter),
                  child: Column(children: [
                    LabelledField(label: 'Your name (optional)', controller: _name, textCapitalization: TextCapitalization.words),
                    LabelledField(label: 'Email, so we can reply if you leave (optional)', controller: _email, keyboardType: TextInputType.emailAddress),
                  ]),
                ),
              if (_error != null) Padding(padding: const EdgeInsets.symmetric(horizontal: Brand.gutter), child: Text(_error!, style: Type.small.copyWith(color: Brand.error))),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(Brand.gutter),
                  child: Row(children: [
                    Expanded(
                      child: Semantics(
                        label: 'Message',
                        child: TextField(controller: _text, minLines: 1, maxLines: 4, style: Type.body, textInputAction: TextInputAction.send, onSubmitted: (_) => _send(), decoration: const InputDecoration(hintText: 'Type a message')),
                      ),
                    ),
                    const SizedBox(width: 8),
                    BusyButton(label: 'Send', expand: false, busy: _sending, onPressed: _send),
                  ]),
                ),
              ),
            ]),
    );
  }
}
