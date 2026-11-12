// The camera try-on (module 16). MediaPipe's Face Landmarker finds the face
// in each camera frame; the chosen wig picture is placed on it by the two
// temple points. Everything runs in this browser tab: no picture leaves it.
export {};

// MediaPipe is served from our own server (docs/try-on.md).
const VENDOR = '/vendor/mediapipe';

interface Point { x: number; y: number }
interface Temples { leftX: number; leftY: number; rightX: number; rightY: number }
interface StyleImage { colour: string | null; src: string; width: number; height: number; temples: Temples }
interface Style { slug: string; name: string; price: string | null; images: StyleImage[] }
interface Variant { id: number; lengthInches: number | null; colour: string | null; available: number; priceMinor: number }
interface Landmarker {
  detectForVideo(video: HTMLVideoElement, time: number): { faceLandmarks: Array<Array<{ x: number; y: number }>> };
  detect(image: HTMLImageElement | HTMLCanvasElement): { faceLandmarks: Array<Array<{ x: number; y: number }>> };
  setOptions(o: Record<string, unknown>): Promise<void>;
}

const root = document.querySelector<HTMLElement>('[data-tryon]');
if (root) start(root);

function start(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!;
  const styles = JSON.parse($('[data-tryon-styles]').textContent ?? '[]') as Style[];
  const video = $<HTMLVideoElement>('[data-video]');
  const canvas = $<HTMLCanvasElement>('[data-canvas]');
  const ctx = canvas.getContext('2d')!;
  const status = $('[data-status]');
  const colourSelect = $<HTMLSelectElement>('[data-colour]');
  const lengthSelect = $<HTMLSelectElement>('[data-length]');
  const addButton = $<HTMLButtonElement>('[data-tryon-add]');
  const saveButton = $<HTMLButtonElement>('[data-save]');
  const productLink = $<HTMLAnchorElement>('[data-product-link]');
  const switchButton = $<HTMLButtonElement>('[data-switch]');

  let style = styles.find((s) => s.slug === root.dataset.start) ?? styles[0]!;
  let image: StyleImage | null = null;
  const wig = new Image();
  let variants: Variant[] = [];
  let landmarker: Landmarker | null = null;
  let mode: 'none' | 'camera' | 'photo' = 'none';
  let photo: HTMLImageElement | null = null;
  let facing: 'user' | 'environment' = 'user';
  let stream: MediaStream | null = null;
  let smooth: [Point, Point] | null = null;
  let lastVideoTime = -1;

  const say = (text: string): void => {
    status.textContent = text;
  };

  async function loadLandmarker(runningMode: 'VIDEO' | 'IMAGE'): Promise<Landmarker> {
    if (landmarker) {
      await landmarker.setOptions({ runningMode });
      return landmarker;
    }
    say('Getting the try-on ready…');
    const url = `${VENDOR}/vision_bundle.mjs`;
    const vision = (await import(url)) as { FilesetResolver: { forVisionTasks(path: string): Promise<unknown> }; FaceLandmarker: { createFromOptions(files: unknown, o: Record<string, unknown>): Promise<Landmarker> } };
    const files = await vision.FilesetResolver.forVisionTasks(`${VENDOR}/wasm`);
    const options = (delegate: 'GPU' | 'CPU'): Record<string, unknown> => ({ baseOptions: { modelAssetPath: `${VENDOR}/face_landmarker.task`, delegate }, runningMode, numFaces: 1 });
    try {
      landmarker = await vision.FaceLandmarker.createFromOptions(files, options('GPU'));
    } catch {
      landmarker = await vision.FaceLandmarker.createFromOptions(files, options('CPU'));
    }
    say('');
    return landmarker;
  }

  // ----- choosing a style, colour and length -----

  function fillColours(): void {
    const colours = style.images.map((i) => i.colour ?? 'As shown');
    colourSelect.innerHTML = colours.map((c, i) => `<option value="${i}">${c.replace(/[<>&"]/g, '')}</option>`).join('');
    colourSelect.parentElement!.hidden = colours.length < 2;
  }

  function pickImage(index: number): void {
    image = style.images[index] ?? style.images[0] ?? null;
    if (image) wig.src = image.src;
    fillLengths();
    draw();
  }

  function fillLengths(): void {
    const colour = image?.colour?.toLowerCase() ?? null;
    const usable = variants.filter((v) => v.available > 0 && (colour === null || (v.colour ?? '').toLowerCase() === colour));
    lengthSelect.innerHTML = usable.map((v) => `<option value="${v.id}">${v.lengthInches ? `${v.lengthInches}"` : 'One length'}</option>`).join('');
    lengthSelect.parentElement!.hidden = usable.length < 2;
    addButton.disabled = usable.length === 0;
    addButton.textContent = usable.length === 0 && variants.length ? 'Sold out in this colour' : 'Add to bag';
  }

  async function chooseStyle(slug: string): Promise<void> {
    style = styles.find((s) => s.slug === slug) ?? style;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-style]')) b.setAttribute('aria-checked', String(b.dataset.style === style.slug));
    productLink.href = `/products/${encodeURIComponent(style.slug)}/`;
    productLink.textContent = `See ${style.name}`;
    fillColours();
    variants = [];
    pickImage(0);
    try {
      const res = await fetch(`/api/catalog/products/${encodeURIComponent(style.slug)}?currency=${encodeURIComponent(root.dataset.currency ?? '')}`, { headers: { Accept: 'application/json' } });
      if (res.ok) variants = ((await res.json()) as { product: { variants: Variant[] } }).product.variants;
    } catch {
      // Add to bag stays off; the details link still works.
    }
    fillLengths();
  }

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-style]')) b.addEventListener('click', () => void chooseStyle(b.dataset.style ?? ''));
  colourSelect.addEventListener('change', () => pickImage(Number(colourSelect.value)));
  wig.addEventListener('load', () => draw());

  // ----- placing the wig -----

  /** The temples on the face: MediaPipe face mesh points 162 and 389. */
  function templesFrom(landmarks: Array<{ x: number; y: number }>, width: number, height: number, mirrored: boolean): [Point, Point] | null {
    const a = landmarks[162];
    const b = landmarks[389];
    if (!a || !b) return null;
    const px = (p: { x: number; y: number }): Point => ({ x: (mirrored ? 1 - p.x : p.x) * width, y: p.y * height });
    const [p, q] = [px(a), px(b)];
    return p.x <= q.x ? [p, q] : [q, p];
  }

  function placeWig(points: [Point, Point]): void {
    if (!image || !wig.complete || wig.naturalWidth === 0) return;
    const sx = wig.naturalWidth;
    const sy = wig.naturalHeight;
    const a = { x: image.temples.leftX * sx, y: image.temples.leftY * sy };
    const b = { x: image.temples.rightX * sx, y: image.temples.rightY * sy };
    const [p, q] = points;
    const scale = Math.hypot(q.x - p.x, q.y - p.y) / Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(q.y - p.y, q.x - p.x) - Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.translate(-a.x, -a.y);
    ctx.drawImage(wig, 0, 0);
    ctx.restore();
  }

  function draw(): void {
    if (mode === 'photo' && photo) drawPhoto();
  }

  // ----- the camera -----

  async function startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      say('This browser cannot use the camera. Upload a photo instead.');
      return;
    }
    try {
      stream?.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (error) {
      const name = (error as { name?: string }).name;
      $('[data-ask]').hidden = true;
      if (name === 'NotAllowedError' || name === 'SecurityError') $('[data-refused]').hidden = false;
      else say('We could not start the camera. Close other apps using it, or upload a photo instead.');
      return;
    }
    video.srcObject = stream;
    await video.play();
    $('[data-ask]').hidden = true;
    $('[data-refused]').hidden = true;
    mode = 'camera';
    saveButton.disabled = false;
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    switchButton.hidden = cameras.length < 2;
    try {
      await loadLandmarker('VIDEO');
    } catch {
      say('The try-on could not start in this browser. Try the latest Chrome, Safari, Edge or Firefox.');
      return;
    }
    smooth = null;
    requestAnimationFrame(frame);
  }

  function frame(): void {
    if (mode !== 'camera' || !landmarker) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const mirrored = facing === 'user';
      ctx.save();
      if (mirrored) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const found = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0];
        const points = found ? templesFrom(found, w, h, mirrored) : null;
        if (points) {
          // Smooth the movement so the wig does not shiver.
          smooth = smooth ? [mix(smooth[0], points[0]), mix(smooth[1], points[1])] : points;
          status.textContent = '';
        } else {
          smooth = null;
          if (!status.textContent) say('Look straight at the camera.');
        }
      }
      if (smooth) placeWig(smooth);
    }
    requestAnimationFrame(frame);
  }

  const mix = (a: Point, b: Point): Point => ({ x: a.x * 0.6 + b.x * 0.4, y: a.y * 0.6 + b.y * 0.4 });

  $('[data-start-camera]').addEventListener('click', () => void startCamera());
  switchButton.addEventListener('click', () => {
    facing = facing === 'user' ? 'environment' : 'user';
    void startCamera();
  });

  // ----- a photo instead -----

  let photoPoints: [Point, Point] | null = null;

  function drawPhoto(): void {
    if (!photo) return;
    canvas.width = photo.naturalWidth;
    canvas.height = photo.naturalHeight;
    ctx.drawImage(photo, 0, 0);
    if (photoPoints) placeWig(photoPoints);
  }

  for (const input of root.querySelectorAll<HTMLInputElement>('[data-photo]')) {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      stream?.getTracks().forEach((t) => t.stop());
      mode = 'photo';
      $('[data-ask]').hidden = true;
      $('[data-refused]').hidden = true;
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode().catch(() => undefined);
      if (!img.naturalWidth) {
        say('That file could not be opened. Choose a JPEG or PNG photo.');
        return;
      }
      // Very large photos are made smaller first, to keep the page quick.
      const max = 1600;
      if (img.naturalWidth > max || img.naturalHeight > max) {
        const k = max / Math.max(img.naturalWidth, img.naturalHeight);
        const small = document.createElement('canvas');
        small.width = Math.round(img.naturalWidth * k);
        small.height = Math.round(img.naturalHeight * k);
        small.getContext('2d')!.drawImage(img, 0, 0, small.width, small.height);
        photo = new Image();
        photo.src = small.toDataURL('image/jpeg', 0.92);
        await photo.decode();
      } else {
        photo = img;
      }
      photoPoints = null;
      drawPhoto();
      saveButton.disabled = false;
      try {
        const lm = await loadLandmarker('IMAGE');
        const found = lm.detect(photo).faceLandmarks[0];
        photoPoints = found ? templesFrom(found, photo.naturalWidth, photo.naturalHeight, false) : null;
        say(photoPoints ? '' : 'We could not find a face. Try a clear photo looking straight at the camera.');
      } catch {
        say('The try-on could not start in this browser. Try the latest Chrome, Safari, Edge or Firefox.');
      }
      drawPhoto();
    });
  }

  // ----- add to bag and save -----

  addButton.addEventListener('click', async () => {
    const variantId = Number(lengthSelect.value);
    if (!variantId) return;
    addButton.disabled = true;
    const out = $('[data-add-status]');
    try {
      const res = await fetch('/api/cart/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ variantId, quantity: 1 }) });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      out.innerHTML = res.ok ? 'Added to your bag. <a class="link" href="/cart/">View bag</a>' : (data.error?.message ?? 'That did not work. Try again.').replace(/[<>&]/g, '');
    } catch {
      out.textContent = 'We could not reach the shop. Check your connection and try again.';
    } finally {
      addButton.disabled = false;
    }
  });

  saveButton.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hairbydemj-${style.slug}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, 'image/png');
  });

  // Stop the camera when leaving the page.
  window.addEventListener('pagehide', () => stream?.getTracks().forEach((t) => t.stop()));

  void chooseStyle(style.slug);
}
