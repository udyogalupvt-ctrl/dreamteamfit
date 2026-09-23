export const CLOUDINARY_CLOUD_NAME =
  (import.meta.env["VITE_CLOUDINARY_CLOUD_NAME"] as string | undefined) ?? "dcoimqij";
export const CLOUDINARY_UPLOAD_PRESET =
  (import.meta.env["VITE_CLOUDINARY_UPLOAD_PRESET"] as string | undefined) ?? "levelupingup";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
}

export interface UploadOptions {
  folder?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Unsupported file type. Use JPG, PNG, WEBP or AVIF.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image is larger than 5 MB. Please choose a smaller file.";
  }
  return null;
}

/** Unsigned Cloudinary upload with real progress reporting. */
export function uploadImage(file: File, options: UploadOptions = {}): Promise<UploadedImage> {
  const validationError = validateImageFile(file);
  if (validationError) return Promise.reject(new Error(validationError));

  return new Promise<UploadedImage>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (options.folder) form.append("folder", options.folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve({
          url: data.secure_url,
          publicId: data.public_id,
          width: data.width,
          height: data.height,
          format: data.format,
        });
      } else {
        let message = "Upload failed.";
        try {
          message = JSON.parse(xhr.responseText)?.error?.message ?? message;
        } catch {
          /* ignore parse error */
        }
        reject(new Error(message));
      }
    };

    options.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/** Build a transformed delivery URL (e.g. square avatar crops). */
export function cloudinaryUrl(publicId: string, transform = "f_auto,q_auto,w_400,h_400,c_fill") {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${transform}/${publicId}`;
}

/** Convenience helper: uploads an image and resolves with its secure URL. */
export async function uploadImageUrl(file: File, options: UploadOptions = {}): Promise<string> {
  const result = await uploadImage(file, options);
  return result.url;
}
