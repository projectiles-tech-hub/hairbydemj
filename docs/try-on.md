# Try-on

Customers see a wig on themselves with the camera, on the website and in
the app, before buying. Everything happens on the customer's own device: no
camera picture or photo is sent to the server. A photo can be used instead
of the camera.

## How it works

| Where | Face tracking | Code |
| --- | --- | --- |
| Website (`/try-on/`, and "Try it on with your camera" on product pages) | MediaPipe Face Landmarker, served from our own server | `browser/try-on.ts`, `server/site/store/tryon.ts` |
| iPhone app | ARKit face tracking (iPhone X and later) | `mobile/ios/Runner/AppDelegate.swift` |
| Android app | ARCore Augmented Faces (phones with Google Play Services for AR) | `mobile/android/.../MainActivity.kt` |

Each finds two points on the face, the temples, and the wig picture is
moved, sized and turned so its own temple points land there. The app's
screens are in `mobile/lib/screens/try_on.dart`; the iPhone and Android code
only tracks the face and sends the two points.

On the website, a photo is checked for a face the same way. In the app, a
photo is shown with the wig on it and the customer drags and pinches the
wig into place. Phones without face tracking get the photo try-on only.

From the try-on, customers switch style and colour, choose the length, add
to the bag, and save a photo (a download on the website, the phone's Photos
in the app).

## Preparing wig pictures

Each picture is a PNG with a see-through background, of the wig seen from
the front, one per colour (or one for every colour).

The template: **1000 by 1200 pixels**, the wearer's temples at **30% and 70%
across, 42% down** (300, 504 and 700, 504). Lay a front-facing photo of the
wig on a mannequin or model over the template, line the temples up, remove
the face and background, and export as PNG. Pictures drawn differently can
be uploaded with their own temple positions (fractions from 0 to 1).

Upload them in the admin, on the product's page, under **Try-on pictures**.
Rules: PNG only, at least 400 pixels wide, at most 15 MB, up to 12 per
product, one per colour. They are kept at most 1200 pixels wide, as PNG and
WebP, with hidden file details removed.

## Addresses

| Address | What it does |
| --- | --- |
| `POST /api/products/:id/try-on?colour=&leftX=&leftY=&rightX=&rightY=` (admin) | The body is the PNG. Products, change |
| `GET /api/products/:id/try-on` (admin) | The product's try-on pictures |
| `POST /api/try-on/:id/delete` (admin) | Removes a picture and its files |
| `GET /api/catalog/try-on`, `GET /v1/catalog/try-on?currency=` | Published products that can be tried on, with their pictures |
| `GET .../catalog/products/:slug` | Now includes `tryOn`, the product's pictures |

## Setting up the server

1. `npm ci` installs MediaPipe (`@mediapipe/tasks-vision`, Apache 2.0
   licence); `npm run build` copies its browser files into
   `public/vendor/mediapipe/`.
2. `npm run tryon:model` downloads the face model (about 3.6 MB) from
   Google's MediaPipe site into the same folder, once. The file is checked
   against a fixed checksum; a different file is refused and nothing is
   saved. The try-on page then needs nothing from outside our server.
3. The try-on page alone allows WebAssembly (`'wasm-unsafe-eval'`) and
   camera pictures (`blob:`) in its security policy; every other page keeps
   the stricter one.

The model and MediaPipe files were checked in GitHub Actions: they load in
Chromium and find the face points the try-on uses.

## In the app

- iPhone: the camera, Photos (choose) and Photos (add) wording is in
  `Info.plist`.
- Android: the camera permission is asked when the try-on opens; ARCore is
  marked optional, so phones without it still install the app; the app needs
  Android 7 or later.

## Still to do on real devices

Placement is set from the template and each platform's face points. It is
tuned on real phones and browsers with the owner's wig pictures before
launch (the module's last step).
