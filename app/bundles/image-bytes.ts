export const MAX_IMAGE_EDGE = 4472;
export const MAX_IMAGE_RATIO = 100;

export type DetectedImage = {
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  extension: "jpg" | "png" | "webp" | "gif";
  width: number;
  height: number;
};

export type ImageByteResult =
  | { ok: true; image: DetectedImage }
  | { ok: false; code: "empty" | "invalid_type" | "mime_mismatch" | "corrupted" | "invalid_dimensions"; message: string };

const MIME_EXTENSION: Record<DetectedImage["mime"], DetectedImage["extension"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function inspectImageBytes(bytes: Uint8Array, claimedMime?: string | null): ImageByteResult {
  if (bytes.byteLength === 0) return { ok: false, code: "empty", message: "Choose an image file." };
  const detected = detect(bytes);
  if (!detected.ok) return detected;
  const claimed = normalizeMime(claimedMime);
  if (claimed && claimed !== detected.image.mime) {
    return { ok: false, code: "mime_mismatch", message: "The file contents do not match its declared image type." };
  }
  const dimensions = checkDimensions(detected.image.width, detected.image.height);
  if (!dimensions.ok) return dimensions;
  return detected;
}

function detect(bytes: Uint8Array): ImageByteResult {
  if (isPng(bytes)) return withSize("image/png", pngSize(bytes));
  if (isGif(bytes)) return withSize("image/gif", gifSize(bytes));
  if (isWebp(bytes)) return withSize("image/webp", webpSize(bytes));
  if (isJpeg(bytes)) return withSize("image/jpeg", jpegSize(bytes));
  return { ok: false, code: "invalid_type", message: "Use a JPEG, PNG, WebP, or GIF image." };
}

function withSize(mime: DetectedImage["mime"], size: { width: number; height: number } | null): ImageByteResult {
  if (!size) return { ok: false, code: "corrupted", message: "This image file is incomplete or corrupted." };
  return { ok: true, image: { mime, extension: MIME_EXTENSION[mime], width: size.width, height: size.height } };
}

function checkDimensions(width: number, height: number): ImageByteResult | { ok: true } {
  if (width < 1 || height < 1 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    return { ok: false, code: "invalid_dimensions", message: "Image dimensions must be between 1 and 4472 pixels on each side." };
  }
  const ratio = width > height ? width / height : height / width;
  if (ratio > MAX_IMAGE_RATIO) {
    return { ok: false, code: "invalid_dimensions", message: "Image dimensions must stay within a 100 to 1 ratio." };
  }
  return { ok: true };
}

function normalizeMime(value?: string | null) {
  const mime = value?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif") return mime;
  return "";
}

function isPng(bytes: Uint8Array) {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32(bytes, 16), height: u32(bytes, 20) };
}

function isGif(bytes: Uint8Array) {
  const header = ascii(bytes, 0, 6);
  return header === "GIF87a" || header === "GIF89a";
}

function gifSize(bytes: Uint8Array) {
  if (bytes.length < 10) return null;
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function jpegSize(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const length = u16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (length < 7) return null;
      return { height: u16(bytes, offset + 5), width: u16(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function webpSize(bytes: Uint8Array) {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
    const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
    return { width, height };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = u32le(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function u16(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) * 16777216) + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
}

function u32le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) * 16777216);
}
