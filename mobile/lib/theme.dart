import 'package:material_ui/material_ui.dart';

/// The brand colours (docs/design/design-system.md), the same as the website.
class Brand {
  const Brand._();
  static const noir = Color(0xFF040204);
  static const espresso = Color(0xFF2F2119);
  static const gold = Color(0xFFCFA262);
  static const goldLight = Color(0xFFEAC27F);
  static const goldDeep = Color(0xFFAB7A40);
  static const ivory = Color(0xFFE6D5BE);
  static const blush = Color(0xFFDCB597);
  static const error = Color(0xFFE5735F);
  static const line = Color(0xFF4A3D33);
  static const borderControl = Color(0xFF80766A);
  static const textMuted = Color(0xFFA79A8A);
  static const surfacePhoto = Color(0xFF221B19);
  static const surfaceRaised = Color(0xFF41332A);
  static const goldSoft = Color(0xFF312519);

  static const radiusControl = 8.0;
  static const radiusCard = 16.0;
  static const gutter = 16.0;

  static const head = 'Cormorant Garamond';
  static const body = 'Source Sans 3';
}

/// Text styles. Nothing is set below 14 pixels (an accessibility rule from D4).
class Type {
  const Type._();
  static const display = TextStyle(fontFamily: Brand.head, fontWeight: FontWeight.w500, fontSize: 36, height: 1.1, color: Brand.ivory);
  static const h1 = TextStyle(fontFamily: Brand.head, fontWeight: FontWeight.w500, fontSize: 28, height: 1.15, color: Brand.ivory);
  static const h2 = TextStyle(fontFamily: Brand.head, fontWeight: FontWeight.w500, fontSize: 24, height: 1.2, color: Brand.ivory);
  static const h3 = TextStyle(fontFamily: Brand.body, fontWeight: FontWeight.w600, fontSize: 18, height: 1.3, color: Brand.ivory);
  static const body = TextStyle(fontFamily: Brand.body, fontWeight: FontWeight.w400, fontSize: 16, height: 1.45, color: Brand.ivory);
  static const strong = TextStyle(fontFamily: Brand.body, fontWeight: FontWeight.w600, fontSize: 16, height: 1.45, color: Brand.ivory);
  static const small = TextStyle(fontFamily: Brand.body, fontWeight: FontWeight.w400, fontSize: 14, height: 1.4, color: Brand.textMuted);
  static const price = TextStyle(fontFamily: Brand.body, fontWeight: FontWeight.w600, fontSize: 20, height: 1.3, color: Brand.gold);
}

ThemeData buildTheme() {
  final scheme = const ColorScheme.dark(
    primary: Brand.gold,
    onPrimary: Brand.noir,
    secondary: Brand.goldLight,
    onSecondary: Brand.noir,
    surface: Brand.noir,
    onSurface: Brand.ivory,
    error: Brand.error,
    onError: Brand.noir,
    outline: Brand.borderControl,
    outlineVariant: Brand.line,
  );
  final control = OutlineInputBorder(borderRadius: BorderRadius.circular(Brand.radiusControl), borderSide: const BorderSide(color: Brand.borderControl));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Brand.noir,
    fontFamily: Brand.body,
    textTheme: const TextTheme(
      displaySmall: Type.display,
      headlineMedium: Type.h1,
      headlineSmall: Type.h2,
      titleMedium: Type.h3,
      bodyLarge: Type.body,
      bodyMedium: Type.body,
      bodySmall: Type.small,
      labelLarge: Type.strong,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.noir,
      foregroundColor: Brand.ivory,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: Type.h2,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Brand.noir,
      indicatorColor: Brand.surfaceRaised,
      surfaceTintColor: Colors.transparent,
      height: 72,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => Type.small.copyWith(color: s.contains(WidgetState.selected) ? Brand.gold : Brand.textMuted)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? Brand.gold : Brand.textMuted)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Brand.espresso,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: control,
      enabledBorder: control,
      focusedBorder: control.copyWith(borderSide: const BorderSide(color: Brand.gold, width: 2)),
      errorBorder: control.copyWith(borderSide: const BorderSide(color: Brand.error)),
      focusedErrorBorder: control.copyWith(borderSide: const BorderSide(color: Brand.error, width: 2)),
      labelStyle: Type.strong,
      floatingLabelBehavior: FloatingLabelBehavior.never,
      hintStyle: Type.small,
      helperStyle: Type.small,
      errorStyle: Type.small.copyWith(color: Brand.error),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.gold,
        foregroundColor: Brand.noir,
        disabledBackgroundColor: Brand.surfaceRaised,
        disabledForegroundColor: Brand.textMuted,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: const StadiumBorder(),
        textStyle: Type.strong,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Brand.gold,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        side: const BorderSide(color: Brand.gold),
        shape: const StadiumBorder(),
        textStyle: Type.strong,
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: Brand.gold, minimumSize: const Size(48, 48), textStyle: Type.strong)),
    dividerTheme: const DividerThemeData(color: Brand.line, thickness: 1, space: 1),
    chipTheme: ChipThemeData(
      backgroundColor: Brand.noir,
      selectedColor: Brand.gold,
      labelStyle: Type.body,
      secondaryLabelStyle: Type.body.copyWith(color: Brand.noir),
      side: const BorderSide(color: Brand.gold),
      shape: const StadiumBorder(),
      showCheckmark: false,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    ),
    snackBarTheme: SnackBarThemeData(backgroundColor: Brand.surfaceRaised, contentTextStyle: Type.body, behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radiusControl))),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: Brand.espresso, surfaceTintColor: Colors.transparent, showDragHandle: true),
    dialogTheme: DialogThemeData(backgroundColor: Brand.espresso, surfaceTintColor: Colors.transparent, titleTextStyle: Type.h2, contentTextStyle: Type.body),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Brand.gold),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.gold : Colors.transparent),
      checkColor: WidgetStateProperty.all(Brand.noir),
      side: const BorderSide(color: Brand.borderControl, width: 1.5),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.noir : Brand.textMuted),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.gold : Brand.espresso),
    ),
  );
}
