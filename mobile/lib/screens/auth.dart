import 'dart:io' show Platform;
import 'dart:math';

import 'package:material_ui/material_ui.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../api/client.dart';
import '../config.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Signing in: email and password, or Google or Apple when they are set up.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Json> Function() attempt) async {
    setState(() {
      _busy = true;
      _error = null;
      _fields = {};
    });
    try {
      final reply = await attempt();
      if (!mounted) return;
      await AppScope.read(context).signedInWith(reply);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.code == 'email_not_verified') {
        Navigator.of(context).pushReplacementNamed('/verify', arguments: _email.text.trim());
        return;
      }
      setState(() {
        _error = e.message;
        _fields = e.fields;
      });
    } on SignInCancelled {
      // The customer closed the Google or Apple sheet.
    } catch (_) {
      if (mounted) setState(() => _error = 'That sign-in did not work. Please try again or use your email.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _signIn() => _run(() => AppScope.read(context).api.post('/v1/auth/sign-in', {'email': _email.text.trim(), 'password': _password.text}));

  void _google() => _run(() async {
        final google = GoogleSignIn(serverClientId: AppConfig.googleServerClientId, clientId: AppConfig.googleIosClientId.isEmpty ? null : AppConfig.googleIosClientId, scopes: const ['email']);
        final account = await google.signIn();
        if (account == null) throw SignInCancelled();
        final idToken = (await account.authentication).idToken;
        if (idToken == null) throw SignInCancelled();
        if (!mounted) throw SignInCancelled();
        return AppScope.read(context).api.post('/v1/auth/google', {'idToken': idToken});
      });

  void _apple() => _run(() async {
        final nonce = _nonce();
        AuthorizationCredentialAppleID credential;
        try {
          credential = await SignInWithApple.getAppleIDCredential(scopes: const [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName], nonce: nonce);
        } on SignInWithAppleAuthorizationException catch (e) {
          if (e.code == AuthorizationErrorCode.canceled) throw SignInCancelled();
          rethrow;
        }
        final idToken = credential.identityToken;
        if (idToken == null || !mounted) throw SignInCancelled();
        final name = [credential.givenName, credential.familyName].whereType<String>().join(' ');
        return AppScope.read(context).api.post('/v1/auth/apple', {'idToken': idToken, 'nonce': nonce, if (name.isNotEmpty) 'name': name});
      });

  @override
  Widget build(BuildContext context) {
    final apple = AppConfig.appleSignIn && Platform.isIOS;
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: AutofillGroup(
        child: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
          const Text('Track orders, save addresses and keep a wishlist.', style: Type.body),
          const SizedBox(height: 24),
          LabelledField(label: 'Email', controller: _email, error: _fields['email'], keyboardType: TextInputType.emailAddress, autofill: const [AutofillHints.email]),
          LabelledField(label: 'Password', controller: _password, error: _fields['password'], obscure: true, autofill: const [AutofillHints.password], textInputAction: TextInputAction.done, onSubmitted: (_) => _signIn()),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: Type.body.copyWith(color: Brand.error))),
          BusyButton(label: 'Sign in', busy: _busy, onPressed: _signIn),
          Align(child: TextButton(onPressed: () => Navigator.of(context).pushNamed('/forgot'), child: const Text('Forgotten your password?'))),
          if (AppConfig.googleSignIn || apple) ...[
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Row(children: [Expanded(child: Divider()), Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: Type.small)), Expanded(child: Divider())])),
            if (apple) Padding(padding: const EdgeInsets.only(bottom: 12), child: BusyButton(label: 'Continue with Apple', outlined: true, onPressed: _busy ? null : _apple)),
            if (AppConfig.googleSignIn) BusyButton(label: 'Continue with Google', outlined: true, onPressed: _busy ? null : _google),
          ],
          const SizedBox(height: 24),
          const Divider(),
          const SizedBox(height: 16),
          const Text('New to hairbydemj?', style: Type.strong),
          const SizedBox(height: 8),
          BusyButton(label: 'Create an account', outlined: true, onPressed: () => Navigator.of(context).pushReplacementNamed('/sign-up')),
        ]),
      ),
    );
  }
}

class SignInCancelled implements Exception {}

String _nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  final r = Random.secure();
  return List.generate(32, (_) => chars[r.nextInt(chars.length)]).join();
}

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _offers = false;
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  @override
  void dispose() {
    for (final c in [_first, _last, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _fields = {};
    });
    try {
      await AppScope.read(context).api.post('/v1/auth/sign-up', {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'email': _email.text.trim(),
        'password': _password.text,
        'marketingConsent': _offers,
      });
      if (mounted) Navigator.of(context).pushReplacementNamed('/verify', arguments: _email.text.trim());
    } on ApiError catch (e) {
      setState(() {
        _error = e.message;
        _fields = e.fields;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create an account')),
      body: AutofillGroup(
        child: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
          LabelledField(label: 'First name', controller: _first, error: _fields['firstName'], autofill: const [AutofillHints.givenName], textCapitalization: TextCapitalization.words),
          LabelledField(label: 'Last name', controller: _last, error: _fields['lastName'], autofill: const [AutofillHints.familyName], textCapitalization: TextCapitalization.words),
          LabelledField(label: 'Email', controller: _email, error: _fields['email'], keyboardType: TextInputType.emailAddress, autofill: const [AutofillHints.email]),
          LabelledField(label: 'Password', controller: _password, error: _fields['password'], obscure: true, help: 'At least 8 characters.', autofill: const [AutofillHints.newPassword], textInputAction: TextInputAction.done),
          CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _offers, onChanged: (v) => setState(() => _offers = v ?? false), title: const Text('Email me offers and new arrivals', style: Type.body)),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: Type.body.copyWith(color: Brand.error))),
          BusyButton(label: 'Create account', busy: _busy, onPressed: _submit),
          const SizedBox(height: 12),
          const Text('By creating an account you agree to our terms and privacy policy.', style: Type.small),
          Align(child: TextButton(onPressed: () => Navigator.of(context).pushReplacementNamed('/sign-in'), child: const Text('Already have an account? Sign in'))),
        ]),
      ),
    );
  }
}

/// The six-digit code emailed after signing up.
class VerifyScreen extends StatefulWidget {
  const VerifyScreen({super.key, required this.email});
  final String email;

  @override
  State<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends State<VerifyScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final state = AppScope.read(context);
    try {
      final reply = await state.api.post('/v1/auth/verify-email', {'email': widget.email, 'code': _code.text.trim()});
      await state.signedInWith(reply);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      setState(() => _error = e.fields['code'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    setState(() => _sending = true);
    try {
      await AppScope.read(context).api.post('/v1/auth/resend-code', {'email': widget.email});
      if (mounted) showMessage(context, 'We have sent a new code.');
    } on ApiError catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Check your email')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        Text('We have sent a six-digit code to ${widget.email}. Enter it here to finish.', style: Type.body),
        const SizedBox(height: 24),
        LabelledField(label: 'Code', controller: _code, error: _error, keyboardType: TextInputType.number, autofill: const [AutofillHints.oneTimeCode], textInputAction: TextInputAction.done, onSubmitted: (_) => _verify()),
        BusyButton(label: 'Confirm', busy: _busy, onPressed: _verify),
        const SizedBox(height: 12),
        BusyButton(label: 'Send a new code', outlined: true, busy: _sending, onPressed: _resend),
        const SizedBox(height: 12),
        const Text('No email? Check your spam folder.', style: Type.small),
      ]),
    );
  }
}

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).api.post('/v1/auth/forgot-password', {'email': _email.text.trim()});
      setState(() => _sent = true);
    } on ApiError catch (e) {
      setState(() => _error = e.fields['email'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset your password')),
      body: ListView(padding: const EdgeInsets.all(Brand.gutter), children: [
        if (_sent) ...[
          Text('If ${_email.text.trim()} has an account, we have emailed a link to choose a new password. The link works for one hour.', style: Type.body),
          const SizedBox(height: 24),
          BusyButton(label: 'Back to sign in', onPressed: () => Navigator.of(context).pop()),
        ] else ...[
          const Text("Enter your email and we'll send you a link to choose a new password.", style: Type.body),
          const SizedBox(height: 24),
          LabelledField(label: 'Email', controller: _email, error: _error, keyboardType: TextInputType.emailAddress, autofill: const [AutofillHints.email], textInputAction: TextInputAction.done, onSubmitted: (_) => _send()),
          BusyButton(label: 'Send the link', busy: _busy, onPressed: _send),
        ],
      ]),
    );
  }
}
