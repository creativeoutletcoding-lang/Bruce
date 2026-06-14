/**
 * Native camera / photo-library pickers — iOS shell only.
 *
 * `@capacitor/camera` is lazy-imported inside each function so the plugin never
 * enters the web/SSR bundle entry path (same pattern as `loadApp()` in
 * `lib/native/index.ts`). Callers MUST guard every call with `isNative()`.
 *
 * Both functions return browser `File` objects on purpose: the caller routes
 * them through the EXACT same attach pipeline (HEIC/size guards + resize via
 * `processFile`) as the web `<input type=file>`. The only thing that differs
 * between web and native is how the bytes are acquired — never how they are
 * processed. A photo attaches identically on desktop and iOS.
 *
 * HEIC NORMALIZATION: iPhones shoot HEIC/HEIF by default and `pickImages`
 * returns the original gallery asset (blob type `image/heic`). The shared
 * `ingestFiles` guard rejects HEIC, and Anthropic vision can't read it either,
 * so every image acquired here is normalized to JPEG via `toJpegFile()` BEFORE
 * it leaves this module. WKWebView decodes HEIC in an `<img>`/canvas natively,
 * so the re-encode needs no extra dependency. The web path is untouched.
 */

function base64ToFile(base64: string, format: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: `image/${format}` });
}

/**
 * Re-encode a HEIC/HEIF image File to JPEG via canvas (WKWebView decodes HEIC
 * in `<img>`). Non-HEIC images pass through untouched. On decode failure the
 * original File is returned so the caller's guard can surface a clean error
 * rather than us throwing.
 */
async function toJpegFile(file: File): Promise<File> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    ext === "heic" ||
    ext === "heif";
  if (!isHeic) return file;

  const url = URL.createObjectURL(file);
  try {
    const jpegBlob = await new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    // [attach-debug] TEMPORARY — remove once Jake confirms on-device.
    console.log("[attach-debug] toJpegFile", {
      from: { name: file.name, type: file.type, size: file.size },
      decoded: Boolean(jpegBlob),
    });
    if (!jpegBlob) return file;
    const jpegName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    return new File([jpegBlob], jpegName.toLowerCase().endsWith(".jpg") ? jpegName : `${jpegName}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Capture a single photo with the device camera. Returns `[]` if the user
 * cancels or denies — web cancel is silent too, so we match that.
 */
export async function takePhotoNative(): Promise<File[]> {
  const { Camera, CameraSource, CameraResultType } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Base64,
      quality: 90,
      correctOrientation: true,
      allowEditing: false,
    });
    if (!photo.base64String) return [];
    const fmt = photo.format || "jpeg";
    const raw = base64ToFile(photo.base64String, fmt, `photo-${Date.now()}.${fmt}`);
    // [attach-debug] TEMPORARY — remove once Jake confirms on-device.
    console.log("[attach-debug] takePhotoNative selected", { name: raw.name, type: raw.type, size: raw.size, fmt });
    return [await toJpegFile(raw)];
  } catch (err) {
    // Cancel/deny throws ("User cancelled photos app") — treat as no selection.
    // [attach-debug] TEMPORARY — remove once Jake confirms on-device.
    console.log("[attach-debug] takePhotoNative caught", err);
    return [];
  }
}

/**
 * Pick one OR MORE images from the photo library (multi-select — mirrors the
 * web input's `multiple`). Returns `[]` if cancelled. Each `GalleryPhoto`
 * exposes a `webPath` we fetch into a Blob → File, then normalize to JPEG so
 * the bytes flow through the shared guards just like a dropped/selected file.
 */
export async function pickPhotosNative(): Promise<File[]> {
  const { Camera } = await import("@capacitor/camera");
  try {
    const { photos } = await Camera.pickImages({ quality: 90, correctOrientation: true });
    const files = await Promise.all(
      photos.map(async (p, i) => {
        const blob = await (await fetch(p.webPath)).blob();
        const fmt = p.format || "jpeg";
        const raw = new File([blob], `photo-${Date.now()}-${i}.${fmt}`, {
          type: blob.type || `image/${fmt}`,
        });
        // [attach-debug] TEMPORARY — remove once Jake confirms on-device.
        console.log("[attach-debug] pickPhotosNative selected", { name: raw.name, type: raw.type, size: raw.size, fmt });
        return toJpegFile(raw);
      })
    );
    return files;
  } catch (err) {
    // [attach-debug] TEMPORARY — remove once Jake confirms on-device.
    console.log("[attach-debug] pickPhotosNative caught", err);
    return [];
  }
}
