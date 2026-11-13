# Module 15 — Flutter app

**Status:** In review (pull request open; the owner's merge is the approval) · **Depends on:** D4 approved, backend modules 1–12

## Goal

The iOS and Android app, built with Flutter from the approved designs.

## Steps

- [x] Flutter project in mobile/ (latest stable release)
- [x] Design system applied (colours, fonts, components)
- [x] API client and sign-in (email, Google, Apple)
- [x] Shopping screens, cart and checkout
- [x] Account screens
- [x] Push notifications (APNs and Firebase Cloud Messaging)
- [x] Onboarding, settings and system screens
- [x] GitHub Actions builds for iOS and Android
- [ ] Tests on real iPhones and Android phones

## Done when

Every app screen matches its approved design and works on both platforms.

## Notes (2026-11-13)

- Built on branch `feature/app`, on top of modules 2 to 14. Flutter 3.50
  (stable), Dart 3.14. Guide: [`../app.md`](../app.md).
- Packages: Flutter's Material package, http, secure storage, url_launcher,
  Firebase messaging, Google and Apple sign-in; all free and open source.
- Google sign-in, Apple sign-in and push stay off until the owner's
  accounts and settings are given when building (listed in `app.md`).
- The server gained `GET /v1/catalog/home` (the homepage sections staff
  chose) so the app's home follows the admin.
- Checks run in GitHub Actions: analysis, 11 app tests, an Android build and
  an unsigned iPhone build.
- Not ticked: tests on real iPhones and Android phones. They need the phones
  and the Apple account, and are done with the owner before launch.
