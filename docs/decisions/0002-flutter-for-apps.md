# 0002 — Flutter for the mobile app

**Date:** 2026-10-29 · **Status:** Accepted (owner's decision)

## Decision

The iOS and Android apps are built with Flutter (Dart) as one codebase.

## Considered

- Native Swift (iOS) and Kotlin (Android): two codebases, roughly double the app work.
- Expo / React Native: rejected because of its upsell toward the paid EAS service,
  and because its code-sharing advantage is small when the website is not React.

## Reasons

- Free and open source (BSD licence); Google sells nothing around it.
- Builds run free in GitHub Actions.
- Flutter draws every pixel itself, so custom designs look identical on iPhone and Android.
- Stable, backed by Google.

## Consequences

- No free official over-the-air updates: every app update goes through store review.
- AR try-on uses ARKit and ARCore through Swift/Kotlin platform channels.
