import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const bytesModule = await vite.ssrLoadModule("/app/bundles/image-bytes.ts");
const images = await vite.ssrLoadModule("/app/bundles/images.ts");
const files = await vite.ssrLoadModule("/app/bundles/shopify/files.server.ts");
const editor = await vite.ssrLoadModule("/app/bundles/editor-state.ts");

const shop = "aura-data.myshopify.com";
const otherShop = "other.myshopify.com";
const productId = "gid://shopify/Product/1";
const fileId = "gid://shopify/MediaImage/42";
const fileUrl = "https://cdn.shopify.com/s/files/offer.png";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 0);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return bytes;
}

function jpeg(width: number, height: number) {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x00, 0xff, 0xd9,
  ]);
}

function gif(width: number, height: number) {
  return Uint8Array.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    width & 255, (width >> 8) & 255,
    height & 255, (height >> 8) & 255,
  ]);
}

function webp(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0);
  bytes[24] = (width - 1) & 255;
  bytes[25] = ((width - 1) >> 8) & 255;
  bytes[26] = ((width - 1) >> 16) & 255;
  bytes[27] = (height - 1) & 255;
  bytes[28] = ((height - 1) >> 8) & 255;
  bytes[29] = ((height - 1) >> 16) & 255;
  return bytes;
}

assert.equal(bytesModule.inspectImageBytes(png(48, 48), "image/png").ok, true);
assert.equal(bytesModule.inspectImageBytes(jpeg(64, 32), "image/jpeg").image.mime, "image/jpeg");
assert.equal(bytesModule.inspectImageBytes(gif(8, 8), "image/gif").image.extension, "gif");
assert.equal(bytesModule.inspectImageBytes(webp(20, 20), "image/webp").image.width, 20);
assert.equal(bytesModule.inspectImageBytes(new Uint8Array(), "image/png").code, "empty");
assert.equal(bytesModule.inspectImageBytes(png(8, 8).slice(0, 10), "image/png").code, "corrupted");
assert.equal(bytesModule.inspectImageBytes(Uint8Array.from([1, 2, 3, 4]), "image/png").code, "invalid_type");
assert.equal(bytesModule.inspectImageBytes(png(8, 8), "image/jpeg").code, "mime_mismatch");
assert.equal(bytesModule.inspectImageBytes(png(5000, 10), "image/png").code, "invalid_dimensions");
assert.equal(bytesModule.inspectImageBytes(png(4472, 10), "image/png").code, "invalid_dimensions");
assert.equal(bytesModule.inspectImageBytes(png(100, 1), "image/png").ok, true);

assert.equal(files.decideFilePermission({ granted: true, attempted: false, intent: "stage" }), "granted");
assert.equal(files.decideFilePermission({ granted: false, attempted: false, intent: "stage" }), "request");
assert.equal(files.decideFilePermission({ granted: false, attempted: true, intent: "stage" }), "declined");
assert.equal(files.decideFilePermission({ granted: false, attempted: true, intent: "request" }), "request");
assert.equal(files.decideFilePermission({ granted: false, attempted: false, intent: "resolve" }), "resolve_blocked");

function shopify(steps: Array<(query: string) => Record<string, unknown>>) {
  const calls: string[] = [];
  const admin = {
    graphql: async (query: string) => ({
      json: async () => {
        calls.push(query);
        const step = steps.shift();
        if (!step) throw new Error("Unexpected Shopify request.");
        return { data: step(query) };
      },
    }),
  };
  return { admin, calls };
}

function stageData() {
  return {
    stagedUploadsCreate: {
      stagedTargets: [{
        url: "https://storage.googleapis.com/shopify-staged/upload",
        resourceUrl: "https://storage.googleapis.com/shopify-staged/resource",
        parameters: [{ name: "key", value: "tmp/image.png" }],
      }],
      userErrors: [],
    },
  };
}

function created(status: string) {
  return {
    fileCreate: {
      files: [{ id: fileId, fileStatus: status, alt: "", fileErrors: [] }],
      userErrors: [],
    },
  };
}

function status(fileStatus: string, url: string | null = fileUrl) {
  return {
    node: {
      __typename: "MediaImage",
      id: fileId,
      fileStatus,
      alt: "",
      image: url ? { url } : null,
      fileErrors: [],
    },
  };
}

async function stage(memory: InstanceType<typeof files.UploadMemory>, fetchImpl: typeof fetch, admin: { graphql: (query: string) => Promise<{ json: () => Promise<unknown> }> }, attemptKey = "attempt-1") {
  return files.stageMerchantImage({
    shop,
    admin,
    bytes: png(32, 32),
    claimedMime: "image/png",
    attemptKey,
    memory,
    fetchImpl,
    now: () => 1_000,
  });
}

const posted: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  posted.push(String(input));
  return new Response(null, { status: 201 });
};

const readyFlow = shopify([() => stageData(), () => created("PROCESSING"), () => status("PROCESSING"), () => status("READY")]);
const memory = new files.UploadMemory();
const staged = await stage(memory, fetchImpl, readyFlow.admin);
assert.equal(staged.code, "ready_to_save");
assert.equal(posted.length, 1);
assert.equal(posted[0].startsWith("https://storage.googleapis.com/"), true);
const committed = await files.commitMerchantImage({ shop, admin: readyFlow.admin, uploadId: staged.uploadId, memory, now: () => 1_000, sleep: async () => {} });
assert.equal(committed.code, "ready");
assert.equal(committed.url, fileUrl);
assert.equal(committed.fileId, fileId);
const repeated = await files.commitMerchantImage({ shop, admin: readyFlow.admin, uploadId: staged.uploadId, memory, now: () => 1_000, sleep: async () => {} });
assert.equal(repeated.code, "ready");
assert.equal(readyFlow.calls.filter((query: string) => query.includes("fileCreate")).length, 1);
const foreign = await files.commitMerchantImage({ shop: otherShop, admin: readyFlow.admin, uploadId: staged.uploadId, memory, now: () => 1_000, sleep: async () => {} });
assert.equal(foreign.code, "not_found");
assert.equal((await files.stageMerchantImage({ shop: "", admin: readyFlow.admin, bytes: png(8, 8), attemptKey: "x", memory, fetchImpl, now: () => 1_000 })).code, "unauthorized");

const privateTarget = shopify([() => ({
  stagedUploadsCreate: {
    stagedTargets: [{ url: "https://127.0.0.1/upload", resourceUrl: "https://127.0.0.1/resource", parameters: [] }],
    userErrors: [],
  },
})]);
let privatePosts = 0;
const blocked = await files.stageMerchantImage({
  shop,
  admin: privateTarget.admin,
  bytes: png(8, 8),
  claimedMime: "image/png",
  attemptKey: "private",
  memory: new files.UploadMemory(),
  fetchImpl: async () => {
    privatePosts += 1;
    return new Response(null, { status: 201 });
  },
  now: () => 2_000,
});
assert.equal(blocked.code, "staged_failed");
assert.equal(privatePosts, 0);

const failedCreate = shopify([() => stageData(), () => ({ fileCreate: { files: [], userErrors: [{ message: "The staged upload expired." }] } })]);
const failedMemory = new files.UploadMemory();
const failedStage = await stage(failedMemory, fetchImpl, failedCreate.admin, "expired");
const failedCommit = await files.commitMerchantImage({ shop, admin: failedCreate.admin, uploadId: failedStage.uploadId, memory: failedMemory, now: () => 1_000, sleep: async () => {} });
assert.equal(failedCommit.code, "expired");

const timeoutFlow = shopify([() => stageData(), () => created("PROCESSING"), () => status("PROCESSING"), () => status("PROCESSING"), () => status("PROCESSING"), () => status("PROCESSING"), () => status("PROCESSING"), () => status("READY")]);
const timeoutMemory = new files.UploadMemory();
const timeoutStage = await stage(timeoutMemory, fetchImpl, timeoutFlow.admin, "timeout");
const timedOut = await files.commitMerchantImage({ shop, admin: timeoutFlow.admin, uploadId: timeoutStage.uploadId, memory: timeoutMemory, now: () => 1_000, sleep: async () => {} });
assert.equal(timedOut.code, "timed_out");
assert.equal(timedOut.state, "timed_out");
const recovered = await files.commitMerchantImage({ shop, admin: timeoutFlow.admin, uploadId: timeoutStage.uploadId, memory: timeoutMemory, now: () => 1_000, sleep: async () => {} });
assert.equal(recovered.code, "ready");
assert.equal(timeoutFlow.calls.filter((query: string) => query.includes("fileCreate")).length, 1);

const missing = await files.readMerchantFile(shopify([() => ({ node: null })]).admin, shop, fileId);
assert.equal(missing.code, "unavailable");
const generic = await files.readMerchantFile(shopify([() => ({ node: { __typename: "GenericFile", id: "gid://shopify/GenericFile/1" } })]).admin, shop, "gid://shopify/GenericFile/1");
assert.equal(generic.code, "unavailable");
const failedFile = await files.readMerchantFile(shopify([() => ({ node: { __typename: "MediaImage", id: fileId, fileStatus: "FAILED", fileErrors: [{ message: "Processing failed." }], image: null } })]).admin, shop, fileId);
assert.equal(failedFile.code, "failed");

const oversized = await files.stageMerchantImage({
  shop,
  admin: shopify([]).admin,
  bytes: new Uint8Array(5 * 1024 * 1024 + 1),
  claimedMime: "image/png",
  attemptKey: "big",
  memory: new files.UploadMemory(),
  fetchImpl,
  now: () => 3_000,
});
assert.equal(oversized.code, "invalid_size");

const rateMemory = new files.UploadMemory();
const rateAdmin = {
  graphql: async () => ({ json: async () => ({ data: stageData() }) }),
};
for (let index = 0; index < 8; index += 1) {
  const result = await files.stageMerchantImage({
    shop,
    admin: rateAdmin,
    bytes: png(8, 8),
    claimedMime: "image/png",
    attemptKey: `rate-${index}`,
    memory: rateMemory,
    fetchImpl,
    now: () => 10_000,
  });
  assert.equal(result.code, "ready_to_save");
}
assert.equal((await files.stageMerchantImage({
  shop,
  admin: rateAdmin,
  bytes: png(8, 8),
  claimedMime: "image/png",
  attemptKey: "rate-over",
  memory: rateMemory,
  fetchImpl,
  now: () => 10_000,
})).code, "rate_limited");

const base = editor.emptyDocument("Offer");
const createdBar = editor.createBar("quantity_break", {
  id: productId,
  title: "Tee",
  status: "ACTIVE",
  featuredImageUrl: "https://cdn.shopify.com/tee.png",
  featuredImageAlt: "Tee",
  images: [{ url: "https://cdn.shopify.com/tee.png", alt: "Tee" }],
  imagesComplete: true,
  variantsComplete: true,
  variants: [{ id: "gid://shopify/ProductVariant/1", title: "Small", availableForSale: true }],
}, "bar-1");
assert.equal(createdBar.ok, true);
const withCatalog = {
  ...base,
  bars: [{
    ...createdBar.bar,
    images: {
      ...createdBar.bar.images,
      customBarImage: { source: "catalog", productId, url: "https://cdn.shopify.com/tee.png", alt: "Tee" },
    },
  }],
};
const products = [{ id: productId, images: [{ url: "https://cdn.shopify.com/tee.png" }], imagesComplete: true }];
assert.equal(images.verifyChangedImages(base, withCatalog, products, { allowFixtureImages: false }).ok, true);
assert.equal(images.verifyChangedImages(base, {
  ...withCatalog,
  bars: [{ ...withCatalog.bars[0], images: { ...withCatalog.bars[0].images, customBarImage: { source: "catalog", productId, url: "/fixtures/tee.png", alt: "Tee" } } }],
}, products, { allowFixtureImages: false }).message, "A local fixture image cannot be saved for this shop.");
assert.equal(images.verifyChangedImages(withCatalog, withCatalog, [], { allowFixtureImages: false }).ok, true);
const external = {
  ...withCatalog,
  bars: [{ ...withCatalog.bars[0], images: { ...withCatalog.bars[0].images, featuredImage: { source: "url", url: "https://example.com/a.png", alt: null } } }],
};
assert.match(images.verifyChangedImages(withCatalog, external, products, { allowFixtureImages: false }).message, /external image address/);
const unknownCatalog = {
  ...base,
  bars: [{ ...createdBar.bar, images: { ...createdBar.bar.images, customBarImage: { source: "catalog", productId, url: "https://cdn.shopify.com/missing.png", alt: null } } }],
};
assert.match(images.verifyChangedImages(base, unknownCatalog, products, { allowFixtureImages: false }).message, /not available for this shop/);
const composition = {
  ...base,
  bars: [{
    ...createdBar.bar,
    images: {
      ...createdBar.bar.images,
      customBarImage: { source: "composition", alt: "Generated", items: [{ productId, url: "https://cdn.shopify.com/tee.png", alt: "Tee" }] },
    },
  }],
};
assert.equal(images.verifyChangedImages(base, composition, products, { allowFixtureImages: false }).ok, true);
const fileDocument = {
  ...base,
  bars: [{ ...createdBar.bar, images: { ...createdBar.bar.images, customBarImage: { source: "file", fileId, alt: "" } } }],
};
assert.match(images.verifyChangedImages(base, fileDocument, products, { allowFixtureImages: false }).message, /not available for the current shop/);
assert.equal(images.verifyChangedImages(base, fileDocument, products, { allowFixtureImages: false, readableFileIds: [fileId] }).ok, true);
assert.equal(images.verifyChangedImages(fileDocument, fileDocument, products, { allowFixtureImages: false }).ok, true);
const legacyFile = {
  ...fileDocument,
  bars: [{ ...fileDocument.bars[0], images: { ...fileDocument.bars[0].images, customBarImage: { source: "file", fileId: "gid://shopify/GenericFile/9", alt: "" } } }],
};
assert.match(images.verifyChangedImages(base, legacyFile, products, { allowFixtureImages: false, readableFileIds: ["gid://shopify/GenericFile/9"] }).message, /media image/);
assert.equal(images.verifyChangedImages(legacyFile, legacyFile, products, { allowFixtureImages: false }).ok, true);

await vite.close();
console.log(JSON.stringify({ ok: true, files: "tested" }));
