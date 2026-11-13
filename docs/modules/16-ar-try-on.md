# Module 16 — AR try-on

**Status:** In review (pull request open; the owner's merge is the approval) · **Depends on:** 13, 15

## Goal

Virtual wig try-on on the website and in the app.

## Steps

- [x] Web: MediaPipe Face Landmarker, model hosted on our server
- [x] iOS: ARKit face tracking through a Swift platform channel
- [x] Android: ARCore Augmented Faces through a Kotlin platform channel
- [x] Wig assets prepared for try-on (template, upload in the admin; the owner supplies the pictures)
- [x] Style and colour switching, add to cart
- [ ] Tests on real devices and browsers

## Done when

Customers can try on wigs on the website and in both apps.

## Notes (2026-11-13)

- Built on branch `feature/try-on`, on top of modules 2 to 15. Guide:
  [`../try-on.md`](../try-on.md).
- Wig pictures are see-through PNGs drawn to one template; staff upload one
  per colour in the admin. New table `try_on_images` (migration 0019).
- The face model is downloaded to our server with a fixed checksum
  (`npm run tryon:model`); MediaPipe's files come from npm. Both were checked
  in a browser in GitHub Actions.
- A photo can be used instead of the camera, as in the designs.
- Not ticked: tests on real devices and browsers, with the owner's pictures.
