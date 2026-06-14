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
 */

function base64ToFile(base64: string, format: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: `image/${format}` });
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
    return [base64ToFile(photo.base64String, fmt, `photo-${Date.now()}.${fmt}`)];
  } catch {
    // Cancel/deny throws ("User cancelled photos app") — treat as no selection.
    return [];
  }
}

/**
 * Pick one OR MORE images from the photo library (multi-select — mirrors the
 * web input's `multiple`). Returns `[]` if cancelled. Each `GalleryPhoto`
 * exposes a `webPath` we fetch into a Blob → File so the bytes flow through the
 * shared guards just like a dropped/selected file.
 */
export async function pickPhotosNative(): Promise<File[]> {
  const { Camera } = await import("@capacitor/camera");
  try {
    const { photos } = await Camera.pickImages({ quality: 90, correctOrientation: true });
    const files = await Promise.all(
      photos.map(async (p, i) => {
        const blob = await (await fetch(p.webPath)).blob();
        const fmt = p.format || "jpeg";
        return new File([blob], `photo-${Date.now()}-${i}.${fmt}`, {
          type: blob.type || `image/${fmt}`,
        });
      })
    );
    return files;
  } catch {
    return [];
  }
}
