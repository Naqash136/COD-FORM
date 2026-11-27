import type { ActionFunctionArgs } from "react-router";
import { MAX_IMAGE_BYTES, isMediaImageGid } from "../bundles/images";
import { commitMerchantImage, decideFilePermission, readMerchantFile, stageMerchantImage, uploadMemory } from "../bundles/shopify/files.server";
import { authenticate } from "../shopify.server";

const FILE_SCOPE = "write_files";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session, scopes } = await authenticate.admin(request);
  const form = await request.formData();
  const granted = await scopes.query();
  const intent = String(form.get("intent") ?? "");
  const decision = decideFilePermission({
    granted: granted.granted.includes(FILE_SCOPE),
    attempted: form.get("attempted") === "1",
    intent,
  });
  if (decision === "resolve_blocked") {
    return { ok: false, code: "permission_required", message: "Shopify file images need file permission before they can be displayed.", state: "permission_required", files: [] };
  }
  if (decision === "declined") {
    return { ok: false, code: "permission_declined", message: "File upload permission was declined. Catalog images still work.", state: "permission_declined" };
  }
  if (decision === "request") {
    await scopes.request([FILE_SCOPE]);
    return { ok: false, code: "permission_required", message: "Uploading a new image needs permission to add files in Shopify.", state: "permission_required" };
  }
  if (intent === "resolve") return resolveFiles(admin, session.shop, String(form.get("fileIds") ?? ""));
  if (intent === "commit") {
    return commitMerchantImage({ shop: session.shop, admin, uploadId: String(form.get("uploadId") ?? ""), memory: uploadMemory });
  }
  if (intent !== "stage") return { ok: false, code: "failed", message: "The image request was not recognized.", state: "failed" };
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES + 64_000) {
    return { ok: false, code: "invalid_size", message: "Image must be 5 MB or smaller.", state: "failed" };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, code: "empty", message: "Choose an image file.", state: "failed" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, code: "invalid_size", message: "Image must be 5 MB or smaller.", state: "failed" };
  return stageMerchantImage({
    shop: session.shop,
    admin,
    bytes: new Uint8Array(await file.arrayBuffer()),
    claimedMime: file.type,
    attemptKey: String(form.get("attemptKey") ?? ""),
    memory: uploadMemory,
  });
}

async function resolveFiles(admin: Parameters<typeof readMerchantFile>[0], shop: string, rawIds: string) {
  const ids = [...new Set(rawIds.split(",").map((id) => id.trim()).filter((id) => isMediaImageGid(id)))].slice(0, 20);
  const files = [];
  for (const fileId of ids) {
    const resolved = await readMerchantFile(admin, shop, fileId);
    if (resolved.ok && resolved.code === "ready") {
      files.push({ fileId, url: resolved.url, state: "ready" as const });
    } else if (!resolved.ok && (resolved.code === "processing" || resolved.code === "timed_out")) {
      files.push({ fileId, url: null, state: resolved.code });
    } else {
      files.push({ fileId, url: null, state: "unavailable" as const });
    }
  }
  return { ok: true, code: "resolved", files };
}
