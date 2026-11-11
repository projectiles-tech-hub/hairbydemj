# Module 5 — Media

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Product photos and videos stored on our server, resized and compressed for fast
loading.

## Steps

- [x] Upload route for staff (images and video)
- [x] Image resizing into several sizes with libvips
- [x] Video compression with ffmpeg
- [x] Serving media with long cache times through Caddy and Cloudflare
- [x] Linking media to products and variants
- [x] Tests

## Done when

Uploaded media is stored, processed into the right sizes and served quickly.

## Notes

- Guide: [`../media.md`](../media.md).
- No package added. libvips and ffmpeg are run as command-line tools and
  must be installed on the server: `sudo apt install libvips-tools ffmpeg`.
- New setting `MEDIA_DIR`. Migration `0012_media_processing.sql`.
- Photos are linked to variants by colour.
- "Serving through Caddy and Cloudflare": the files are served with a
  year-long, never-changes cache header and support partial requests. The
  Caddy and Cloudflare set-up itself is module 19; what it must do is
  written in `docs/media.md`.
- Built on top of modules 2 to 4; their pull requests go first.
