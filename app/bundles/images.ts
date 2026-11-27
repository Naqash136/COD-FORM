import type { BundleBar, BundleDocument, CompositionImageItem, ImageRef } from "./schema";

export const DEFAULT_BAR_IMAGE_SIZE = 48;
export const DEFAULT_BAR_IMAGE_RADIUS = 6;
export const BAR_IMAGE_SIZE_MIN = 24;
export const BAR_IMAGE_SIZE_MAX = 128;
export const BAR_IMAGE_RADIUS_MIN = 0;
export const BAR_IMAGE_RADIUS_MAX = 32;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_COMPOSITION_ITEMS = 8;
export const MAX_IMAGE_URL_LENGTH = 2048;

export const UPLOAD_SCOPE_MESSAGE = "Uploading a new image needs the write_files scope. This app is not granted write_files, write_images, or write_themes, so the file was not stored.";

const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const FIXTURE_IMAGE = /^\/fixtures\/[a-z0-9.-]+$/;
const MEDIA_IMAGE_GID = /^gid:\/\/shopify\/MediaImage\/\d+$/;

export type ImageCatalogProduct = {
  id: string;
  title?: string;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  images?: Array<{ url: string; alt: string | null }>;
  imagesComplete?: boolean;
  imagesCursor?: string | null;
};

export type ResolvedImage =
  | { status: "empty" }
  | { status: "single"; url: string; alt: string }
  | { status: "composition"; items: Array<{ url: string; alt: string }> }
  | { status: "unavailable"; reason: "missing" | "file" | "incomplete" };

export function emptyBarImages(): BundleBar["images"] {
  return {
    customBarImage: null,
    featuredImage: null,
    barImageSize: DEFAULT_BAR_IMAGE_SIZE,
    barImageRadius: DEFAULT_BAR_IMAGE_RADIUS,
  };
}

export function isFixtureImageUrl(value: string) {
  return FIXTURE_IMAGE.test(value);
}

export function isMediaImageGid(value: string) {
  return MEDIA_IMAGE_GID.test(value);
}

export function isPersistentImageUrl(value: string) {
  if (value.length === 0 || value.length > MAX_IMAGE_URL_LENGTH) return false;
  if (value.startsWith("data:") || value.startsWith("blob:")) return false;
  if (FIXTURE_IMAGE.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function inspectImageUpload(file: { name: string; type: string; size: number }) {
  const type = file.type || typeFromName(file.name);
  if (!UPLOAD_TYPES.has(type)) {
    return { ok: false as const, code: "invalid_type" as const, message: "Use a JPEG, PNG, WebP, or GIF image." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return { ok: false as const, code: "invalid_size" as const, message: "Image must be 5 MB or smaller." };
  }
  return { ok: true as const, code: "ready_for_upload" as const, message: "" };
}

export function barProductIds(bar: BundleBar) {
  const ids: string[] = [];
  if (bar.type === "quantity_break" || bar.type === "alternative_product") ids.push(bar.config.product.productId);
  if (bar.type === "buy_x_get_y") {
    ids.push(bar.config.product.productId);
    if (bar.config.getProduct) ids.push(bar.config.getProduct.productId);
  }
  if (bar.type === "product_bundle") {
    for (const product of bar.config.products) ids.push(product.product.productId);
  }
  if (bar.type === "mix_and_match") {
    for (const slot of bar.config.slots) ids.push(slot.product.productId);
  }
  return [...new Set(ids)];
}

export function productImages(product: ImageCatalogProduct) {
  const listed = (product.images ?? []).flatMap((image) => (image.url ? [image] : []));
  if (listed.length > 0) return listed;
  if (product.featuredImageUrl) return [{ url: product.featuredImageUrl, alt: product.featuredImageAlt }];
  return [];
}

export function generateComposition(bar: BundleBar, catalog: ImageCatalogProduct[]): { ok: true; image: ImageRef } | { ok: false; message: string } {
  const items: CompositionImageItem[] = [];
  for (const productId of barProductIds(bar)) {
    const product = catalog.find((item) => item.id === productId);
    const image = product ? productImages(product)[0] : undefined;
    if (!image || !isPersistentImageUrl(image.url)) continue;
    items.push({ productId, url: image.url, alt: image.alt });
    if (items.length === MAX_COMPOSITION_ITEMS) break;
  }
  if (items.length === 0) return { ok: false, message: "No product image is available to generate." };
  return { ok: true, image: { source: "composition", alt: "Generated from product images", items } };
}

export function catalogImage(productId: string, url: string, alt: string | null): ImageRef | null {
  if (!isPersistentImageUrl(url)) return null;
  return { source: "catalog", productId, url, alt };
}

export function applyBarImage(bar: BundleBar, image: ImageRef | null, size: number, radius: number): { ok: true; bar: BundleBar } | { ok: false; message: string } {
  if (!validSize(size)) return { ok: false, message: "Image size must be a whole number from 24 to 128." };
  if (!validRadius(radius)) return { ok: false, message: "Border radius must be a whole number from 0 to 32." };
  if (image && !imageIsReference(image)) return { ok: false, message: "Choose a product image or a generated composition." };
  return {
    ok: true,
    bar: { ...bar, images: { ...bar.images, customBarImage: image, barImageSize: size, barImageRadius: radius } },
  };
}

export function applyFeaturedImage(bar: BundleBar, image: ImageRef | null): { ok: true; bar: BundleBar } | { ok: false; message: string } {
  if (image && !imageIsReference(image)) return { ok: false, message: "Choose a product image or a generated composition." };
  return { ok: true, bar: { ...bar, images: { ...bar.images, featuredImage: image } } };
}

export function resolveImage(
  image: ImageRef | null,
  catalog: ImageCatalogProduct[],
  catalogSettled: boolean,
  fileUrls?: Readonly<Record<string, string | null>>,
): ResolvedImage {
  if (!image) return { status: "empty" };
  if (image.source === "file") {
    const url = fileUrls?.[image.fileId];
    if (url && isPersistentImageUrl(url) && !isFixtureImageUrl(url)) return { status: "single", url, alt: image.alt || "Offer image" };
    return { status: "unavailable", reason: "file" };
  }
  if (image.source === "composition") {
    const items = image.items.flatMap((item) => {
      if (!referenceAvailable(item.productId, item.url, catalog, catalogSettled)) return [];
      return [{ url: item.url, alt: item.alt || "Product image" }];
    });
    if (items.length === 0) return { status: "unavailable", reason: catalogSettled ? "missing" : "incomplete" };
    return { status: "composition", items };
  }
  const productId = image.source === "product" || image.source === "catalog" ? image.productId : null;
  const url = imageUrl(image, catalog);
  if (!url) return { status: "unavailable", reason: "missing" };
  if (productId && !referenceAvailable(productId, url, catalog, catalogSettled)) {
    return { status: "unavailable", reason: "missing" };
  }
  if (!productId && catalogSettled && !catalog.some((product) => productImages(product).some((item) => item.url === url))) {
    return { status: "unavailable", reason: "missing" };
  }
  return { status: "single", url, alt: image.alt || "Offer image" };
}

export type GalleryView = {
  mode: "original" | "featured" | "restored";
  url: string | null;
  alt: string;
  composition: Array<{ url: string; alt: string }> | null;
};

export function previewGallery(
  product: { title: string; featuredImageUrl: string | null; featuredImageAlt: string | null },
  bar: BundleBar | null,
  catalog: ImageCatalogProduct[],
  catalogSettled: boolean,
  fileUrls?: Readonly<Record<string, string | null>>,
): GalleryView {
  const original = {
    mode: "original" as const,
    url: product.featuredImageUrl,
    alt: product.featuredImageAlt ?? product.title,
    composition: null,
  };
  if (!bar?.images.featuredImage) return original;
  const resolved = resolveImage(bar.images.featuredImage, catalog, catalogSettled, fileUrls);
  if (resolved.status === "single") {
    return { mode: "featured", url: resolved.url, alt: resolved.alt, composition: null };
  }
  if (resolved.status === "composition") {
    return { mode: "featured", url: null, alt: product.title, composition: resolved.items };
  }
  return { ...original, mode: "restored" };
}

export type OfferIndicator =
  | { kind: "radio" }
  | { kind: "image"; url: string; alt: string; size: number; radius: number }
  | { kind: "composition"; items: Array<{ url: string; alt: string }>; size: number; radius: number };

export function offerIndicator(
  bar: BundleBar,
  catalog: ImageCatalogProduct[],
  catalogSettled: boolean,
  fileUrls?: Readonly<Record<string, string | null>>,
): OfferIndicator {
  const resolved = resolveImage(bar.images.customBarImage, catalog, catalogSettled, fileUrls);
  const size = bar.images.barImageSize || DEFAULT_BAR_IMAGE_SIZE;
  const radius = bar.images.barImageRadius ?? DEFAULT_BAR_IMAGE_RADIUS;
  if (resolved.status === "single") return { kind: "image", url: resolved.url, alt: resolved.alt, size, radius };
  if (resolved.status === "composition") return { kind: "composition", items: resolved.items, size, radius };
  return { kind: "radio" };
}

function imageUrl(image: ImageRef, catalog: ImageCatalogProduct[]) {
  if (image.source === "catalog" || image.source === "url") return isPersistentImageUrl(image.url) ? image.url : null;
  if (image.source === "product") {
    const product = catalog.find((item) => item.id === image.productId);
    return product?.featuredImageUrl && isPersistentImageUrl(product.featuredImageUrl) ? product.featuredImageUrl : null;
  }
  return null;
}

function referenceAvailable(productId: string, url: string, catalog: ImageCatalogProduct[], catalogSettled: boolean) {
  if (!isPersistentImageUrl(url)) return false;
  const product = catalog.find((item) => item.id === productId);
  if (!product) return !catalogSettled;
  if (productImages(product).some((image) => image.url === url)) return true;
  return product.imagesComplete === false;
}

function imageIsReference(image: ImageRef) {
  if (image.source === "file") return /^gid:\/\/shopify\/(?:MediaImage|GenericFile|Image)\/\d+$/.test(image.fileId);
  if (image.source === "product") return /^gid:\/\/shopify\/Product\/\d+$/.test(image.productId);
  if (image.source === "url") return isHttps(image.url);
  if (image.source === "catalog") return /^gid:\/\/shopify\/Product\/\d+$/.test(image.productId) && isPersistentImageUrl(image.url);
  if (image.source !== "composition" || image.items.length === 0 || image.items.length > MAX_COMPOSITION_ITEMS) return false;
  return image.items.every((item) => /^gid:\/\/shopify\/Product\/\d+$/.test(item.productId) && isPersistentImageUrl(item.url));
}

function validSize(value: number) {
  return Number.isInteger(value) && value >= BAR_IMAGE_SIZE_MIN && value <= BAR_IMAGE_SIZE_MAX;
}

function validRadius(value: number) {
  return Number.isInteger(value) && value >= BAR_IMAGE_RADIUS_MIN && value <= BAR_IMAGE_RADIUS_MAX;
}

function isHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= MAX_IMAGE_URL_LENGTH;
  } catch {
    return false;
  }
}

export type ImageSelectionProduct = {
  id: string;
  images?: Array<{ url: string }>;
  imagesComplete?: boolean;
};

export function verifyChangedImages(
  previous: BundleDocument | null,
  next: BundleDocument,
  products: readonly ImageSelectionProduct[],
  options: { allowFixtureImages: boolean; readableFileIds?: readonly string[] },
): { ok: true } | { ok: false; message: string } {
  const known = new Map(products.map((product) => [product.id, product]));
  for (const image of changedImages(previous, next)) {
    const checked = checkNewImage(image, known, options);
    if (!checked.ok) return checked;
  }
  return { ok: true };
}

export function newMediaFileIds(previous: BundleDocument | null, next: BundleDocument) {
  return changedImages(previous, next).flatMap((image) => (
    image.source === "file" && isMediaImageGid(image.fileId) ? [image.fileId] : []
  ));
}

export function fileIdsInDocument(document: BundleDocument) {
  const ids = new Set<string>();
  for (const image of allImages(document)) {
    if (image.source === "file" && isMediaImageGid(image.fileId)) ids.add(image.fileId);
  }
  return [...ids];
}

function changedImages(previous: BundleDocument | null, next: BundleDocument) {
  const prior = new Map(allKeyedImages(previous));
  const images: ImageRef[] = [];
  for (const [key, image] of allKeyedImages(next)) {
    if (JSON.stringify(prior.get(key) ?? null) === JSON.stringify(image)) continue;
    if (image) images.push(image);
  }
  return images;
}

function allImages(document: BundleDocument | null) {
  return allKeyedImages(document).flatMap((entry) => (entry[1] ? [entry[1]] : []));
}

function allKeyedImages(document: BundleDocument | null): Array<[string, ImageRef | null]> {
  if (!document) return [];
  const images: Array<[string, ImageRef | null]> = [];
  for (const bar of document.bars) {
    images.push([`${bar.id}:custom`, bar.images.customBarImage], [`${bar.id}:featured`, bar.images.featuredImage]);
    for (const highlight of bar.highlights) images.push([`${bar.id}:highlight:${highlight.id}`, highlight.icon]);
  }
  return images;
}

function checkNewImage(
  image: ImageRef,
  products: Map<string, ImageSelectionProduct>,
  options: { allowFixtureImages: boolean; readableFileIds?: readonly string[] },
): { ok: true } | { ok: false; message: string } {
  if (image.source === "file") {
    if (!isMediaImageGid(image.fileId)) return { ok: false, message: "A new image must be a Shopify media image." };
    if (!options.readableFileIds?.includes(image.fileId)) return { ok: false, message: "This Shopify file is not available for the current shop." };
    return { ok: true };
  }
  if (image.source === "url") return { ok: false, message: "An external image address cannot be saved." };
  if (image.source === "product") {
    if (!products.has(image.productId)) return { ok: false, message: "A selected product is no longer available in Shopify." };
    return { ok: true };
  }
  if (image.source === "catalog") return checkCatalogUrl(image.productId, image.url, products, options.allowFixtureImages);
  return image.items.reduce<{ ok: true } | { ok: false; message: string }>((result, item) => {
    if (!result.ok) return result;
    return checkCatalogUrl(item.productId, item.url, products, options.allowFixtureImages);
  }, { ok: true });
}

function checkCatalogUrl(
  productId: string,
  url: string,
  products: Map<string, ImageSelectionProduct>,
  allowFixtureImages: boolean,
): { ok: true } | { ok: false; message: string } {
  if (isFixtureImageUrl(url)) {
    if (!allowFixtureImages) return { ok: false, message: "A local fixture image cannot be saved for this shop." };
  } else if (!isHttpsImageUrl(url)) {
    return { ok: false, message: "A product image address must be an https URL." };
  }
  const product = products.get(productId);
  if (!product) return { ok: false, message: "A selected product is no longer available in Shopify." };
  if (product.images?.some((image) => image.url === url)) return { ok: true };
  if (product.imagesComplete === false) return { ok: false, message: "Shopify has not confirmed this product image yet." };
  return { ok: false, message: "That product image is not available for this shop." };
}

function isHttpsImageUrl(value: string) {
  return isPersistentImageUrl(value) && !isFixtureImageUrl(value);
}

function typeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "";
}
