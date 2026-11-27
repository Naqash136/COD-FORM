import { inspectImageBytes } from "../image-bytes";
import { MAX_IMAGE_BYTES, isMediaImageGid } from "../images";
import { adminQuery, type AdminGraphql } from "./admin";

const STAGE_MUTATION = `#graphql
  mutation BundleStageImage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const CREATE_MUTATION = `#graphql
  mutation BundleFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        alt
        fileErrors { code message }
      }
      userErrors { field message }
    }
  }
`;

const STATUS_QUERY = `#graphql
  query BundleFileStatus($id: ID!) {
    node(id: $id) {
      __typename
      ... on MediaImage {
        id
        fileStatus
        alt
        fileErrors { code message }
        image { url }
      }
    }
  }
`;

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const PENDING_TTL_MS = 15 * 60_000;
const MAX_PENDING_PER_SHOP = 40;
const MAX_POLLS = 5;
const POLL_MS = 400;

type PendingStatus = "staged" | "creating" | "processing" | "ready" | "failed" | "timed_out";

type PendingUpload = {
  id: string;
  attemptKey: string;
  shop: string;
  resourceUrl: string;
  filename: string;
  mime: string;
  fileId: string | null;
  previewUrl: string | null;
  status: PendingStatus;
  message: string;
  createdAt: number;
  inflight: Promise<UploadResult> | null;
};

export type UploadResult =
  | { ok: true; code: "ready_to_save"; uploadId: string; state: "ready_to_save" }
  | { ok: true; code: "processing"; uploadId: string; fileId: string; state: "processing" }
  | { ok: true; code: "ready"; uploadId: string; fileId: string; url: string; alt: string | null; state: "ready" }
  | { ok: false; code: "processing"; message: string; fileId: string; state: "processing" }
  | { ok: false; code: "permission_required" | "permission_declined" | "unauthorized" | "rate_limited" | "empty" | "invalid_type" | "mime_mismatch" | "corrupted" | "invalid_dimensions" | "invalid_size" | "staged_failed" | "expired" | "failed" | "timed_out" | "not_found" | "unavailable" | "graphql_error" | "throttled" | "invalid_response"; message: string; uploadId?: string; fileId?: string; state: "permission_required" | "permission_declined" | "failed" | "timed_out" | "unavailable" };

export class UploadMemory {
  private readonly pending = new Map<string, PendingUpload>();
  private readonly attempts = new Map<string, string>();
  private readonly rates = new Map<string, number[]>();

  consume(shop: string, now: number) {
    const recent = (this.rates.get(shop) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      this.rates.set(shop, recent);
      return false;
    }
    recent.push(now);
    this.rates.set(shop, recent);
    return true;
  }

  remember(upload: PendingUpload) {
    this.sweep(upload.createdAt);
    const owned = [...this.pending.values()].filter((item) => item.shop === upload.shop);
    if (owned.length >= MAX_PENDING_PER_SHOP) {
      const oldest = owned.sort((left, right) => left.createdAt - right.createdAt)[0];
      if (oldest) this.forget(oldest);
    }
    this.pending.set(upload.id, upload);
    this.attempts.set(this.attemptId(upload.shop, upload.attemptKey), upload.id);
  }

  find(shop: string, uploadId: string) {
    const upload = this.pending.get(uploadId);
    if (!upload || upload.shop !== shop) return null;
    return upload;
  }

  findAttempt(shop: string, attemptKey: string) {
    const id = this.attempts.get(this.attemptId(shop, attemptKey));
    if (!id) return null;
    return this.find(shop, id);
  }

  forget(upload: PendingUpload) {
    this.pending.delete(upload.id);
    this.attempts.delete(this.attemptId(upload.shop, upload.attemptKey));
  }

  private attemptId(shop: string, attemptKey: string) {
    return `${shop}\n${attemptKey}`;
  }

  private sweep(now: number) {
    for (const upload of this.pending.values()) {
      if (now - upload.createdAt > PENDING_TTL_MS) this.forget(upload);
    }
  }
}

export const uploadMemory = new UploadMemory();

export function decideFilePermission(input: { granted: boolean; attempted: boolean; intent: string }) {
  if (input.granted) return "granted" as const;
  if (input.intent === "resolve") return "resolve_blocked" as const;
  if (input.attempted && input.intent !== "request") return "declined" as const;
  return "request" as const;
}

type StageData = {
  stagedUploadsCreate?: {
    stagedTargets?: Array<{ url?: string | null; resourceUrl?: string | null; parameters?: Array<{ name?: string | null; value?: string | null }> | null } | null> | null;
    userErrors?: Array<{ message?: string | null }> | null;
  } | null;
};

type CreateData = {
  fileCreate?: {
    files?: Array<{ id?: string | null; fileStatus?: string | null; alt?: string | null; fileErrors?: Array<{ message?: string | null }> | null } | null> | null;
    userErrors?: Array<{ message?: string | null }> | null;
  } | null;
};

type StatusData = {
  node?: {
    __typename?: string;
    id?: string | null;
    fileStatus?: string | null;
    alt?: string | null;
    image?: { url?: string | null } | null;
    fileErrors?: Array<{ message?: string | null }> | null;
  } | null;
};

export async function stageMerchantImage(input: {
  shop: string;
  admin: AdminGraphql;
  bytes: Uint8Array;
  claimedMime?: string | null;
  attemptKey: string;
  memory?: UploadMemory;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<UploadResult> {
  if (!input.shop) return failure("unauthorized", "Sign in before uploading an image.");
  const now = input.now ?? Date.now;
  const memory = input.memory ?? uploadMemory;
  const existing = input.attemptKey ? memory.findAttempt(input.shop, input.attemptKey) : null;
  if (existing && now() - existing.createdAt < PENDING_TTL_MS) return stagedResult(existing);
  if (!memory.consume(input.shop, now())) return failure("rate_limited", "Too many image uploads. Wait a minute and try again.");
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) return failure("invalid_size", "Image must be 5 MB or smaller.");
  const inspected = inspectImageBytes(input.bytes, input.claimedMime);
  if (!inspected.ok) return failure(inspected.code, inspected.message);
  const filename = `offer-image-${input.attemptKey.replace(/[^a-z0-9]/gi, "").slice(0, 24) || "file"}.${inspected.image.extension}`;
  const staged = await adminQuery<StageData>(input.admin, STAGE_MUTATION, {
    input: [{
      filename,
      mimeType: inspected.image.mime,
      resource: "IMAGE",
      httpMethod: "POST",
      fileSize: String(input.bytes.byteLength),
    }],
  });
  if (!staged.ok) return failure(staged.code, staged.message);
  const target = staged.data.stagedUploadsCreate?.stagedTargets?.[0];
  const userError = staged.data.stagedUploadsCreate?.userErrors?.[0]?.message;
  if (!target?.url || !target.resourceUrl || userError) {
    return failure("staged_failed", userError || "Shopify could not prepare the upload.");
  }
  if (!trustedStagedUrl(target.url)) return failure("staged_failed", "Shopify returned an upload address that cannot be used.");
  const uploaded = await postStagedFile(input.fetchImpl ?? fetch, target.url, target.parameters ?? [], input.bytes, inspected.image.mime, filename);
  if (!uploaded.ok) return uploaded;
  const pending: PendingUpload = {
    id: crypto.randomUUID(),
    attemptKey: input.attemptKey,
    shop: input.shop,
    resourceUrl: target.resourceUrl,
    filename,
    mime: inspected.image.mime,
    fileId: null,
    previewUrl: null,
    status: "staged",
    message: "",
    createdAt: now(),
    inflight: null,
  };
  memory.remember(pending);
  return stagedResult(pending);
}

export async function commitMerchantImage(input: {
  shop: string;
  admin: AdminGraphql;
  uploadId: string;
  memory?: UploadMemory;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<UploadResult> {
  if (!input.shop) return failure("unauthorized", "Sign in before uploading an image.");
  const memory = input.memory ?? uploadMemory;
  const pending = memory.find(input.shop, input.uploadId);
  if (!pending) return failure("not_found", "Choose the image again. The upload session expired.");
  if (pending.status === "ready" && pending.fileId && pending.previewUrl) {
    return { ok: true, code: "ready", uploadId: pending.id, fileId: pending.fileId, url: pending.previewUrl, alt: null, state: "ready" };
  }
  if (pending.inflight) return pending.inflight;
  const work = finishCommit(input, pending);
  pending.inflight = work;
  try {
    return await work;
  } finally {
    pending.inflight = null;
  }
}

async function finishCommit(input: {
  shop: string;
  admin: AdminGraphql;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}, pending: PendingUpload): Promise<UploadResult> {
  const now = input.now ?? Date.now;
  if (now() - pending.createdAt > PENDING_TTL_MS && !pending.fileId) {
    pending.status = "failed";
    return failure("expired", "The upload expired. Choose the image again.", pending.id);
  }
  if (!pending.fileId) {
    pending.status = "creating";
    const created = await adminQuery<CreateData>(input.admin, CREATE_MUTATION, {
      files: [{ originalSource: pending.resourceUrl, contentType: "IMAGE", alt: "" }],
    });
    if (!created.ok) {
      pending.status = "failed";
      pending.message = created.message;
      return failure(created.code, created.message, pending.id);
    }
    const userError = created.data.fileCreate?.userErrors?.[0]?.message;
    const file = created.data.fileCreate?.files?.[0];
    if (userError || !file?.id || !isMediaImageGid(file.id)) {
      pending.status = "failed";
      const expired = /expired|not found|invalid/i.test(userError ?? "");
      return failure(expired ? "expired" : "failed", userError || "Shopify could not create the image.", pending.id);
    }
    pending.fileId = file.id;
    if (file.fileStatus === "FAILED" || file.fileErrors?.length) {
      pending.status = "failed";
      return failure("failed", file.fileErrors?.[0]?.message || "Shopify could not process the image.", pending.id, file.id);
    }
    if (file.fileStatus === "READY") {
      const resolved = await readReadyFile(input.admin, file.id);
      if (resolved.ok && resolved.code === "ready") {
        pending.status = "ready";
        pending.previewUrl = resolved.url;
        return { ...resolved, uploadId: pending.id };
      }
    }
  }
  const polled = await pollFile(input.admin, pending.fileId, input.sleep);
  if (polled.ok && polled.code === "ready") {
    pending.status = "ready";
    pending.previewUrl = polled.url;
    return { ...polled, uploadId: pending.id };
  }
  if (!polled.ok && polled.code === "timed_out") {
    pending.status = "timed_out";
    return { ok: false, code: "timed_out", message: polled.message, uploadId: pending.id, fileId: pending.fileId ?? polled.fileId, state: "timed_out" };
  }
  pending.status = "failed";
  if (polled.ok) return failure("failed", "Shopify did not finish the image.", pending.id, pending.fileId ?? undefined);
  return failure(polled.code === "processing" ? "failed" : polled.code, polled.message, pending.id, pending.fileId ?? polled.fileId);
}

export async function readMerchantFile(admin: AdminGraphql, shop: string, fileId: string): Promise<UploadResult> {
  if (!shop) return failure("unauthorized", "Sign in before reading an image.");
  if (!isMediaImageGid(fileId)) return failure("unavailable", "This image reference cannot be displayed.");
  return readReadyFile(admin, fileId);
}

async function pollFile(admin: AdminGraphql, fileId: string, sleep: (ms: number) => Promise<void> = delay): Promise<UploadResult> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const status = await readReadyFile(admin, fileId);
    if (status.ok || status.code === "failed" || status.code === "unavailable") return status;
    if (status.code !== "processing") return status;
    if (attempt < MAX_POLLS - 1) await sleep(POLL_MS);
  }
  return { ok: false, code: "timed_out", message: "Shopify has not finished processing this image. Retry without uploading it again.", fileId, state: "timed_out" };
}

async function readReadyFile(admin: AdminGraphql, fileId: string): Promise<UploadResult> {
  const queried = await adminQuery<StatusData>(admin, STATUS_QUERY, { id: fileId });
  if (!queried.ok) return failure(queried.code, queried.message, undefined, fileId);
  const node = queried.data.node;
  if (!node || node.__typename !== "MediaImage" || node.id !== fileId) {
    return failure("unavailable", "This Shopify file is not available for the current shop.", undefined, fileId);
  }
  if (node.fileStatus === "FAILED" || node.fileErrors?.length) {
    return failure("failed", node.fileErrors?.[0]?.message || "Shopify could not process the image.", undefined, fileId);
  }
  if (node.fileStatus === "READY" && node.image?.url) {
    return { ok: true, code: "ready", uploadId: "", fileId, url: node.image.url, alt: node.alt ?? null, state: "ready" };
  }
  if (node.fileStatus === "READY") return failure("unavailable", "Shopify did not return a display address for this image.", undefined, fileId);
  return { ok: false, code: "processing", message: "Shopify is processing the image.", fileId, state: "processing" };
}

async function postStagedFile(
  fetchImpl: typeof fetch,
  target: string,
  parameters: Array<{ name?: string | null; value?: string | null }>,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<UploadResult> {
  const form = new FormData();
  for (const parameter of parameters) {
    if (parameter.name && parameter.value != null) form.append(parameter.name, parameter.value);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  form.append("file", new Blob([copy]), filename);
  let response: Response;
  try {
    response = await fetchImpl(target, { method: "POST", body: form, redirect: "error" });
  } catch {
    return failure("staged_failed", "The image could not be uploaded to Shopify.");
  }
  if (!response.ok) return failure("staged_failed", "Shopify did not accept the image upload.");
  return { ok: true, code: "ready_to_save", uploadId: "", state: "ready_to_save" };
}

function stagedResult(upload: PendingUpload): UploadResult {
  if (upload.status === "ready" && upload.fileId && upload.previewUrl) {
    return { ok: true, code: "ready", uploadId: upload.id, fileId: upload.fileId, url: upload.previewUrl, alt: null, state: "ready" };
  }
  return { ok: true, code: "ready_to_save", uploadId: upload.id, state: "ready_to_save" };
}

function trustedStagedUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") return false;
    if (isPrivateAddress(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function isPrivateAddress(host: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}

function failure(code: Exclude<Extract<UploadResult, { ok: false }>["code"], "processing">, message: string, uploadId?: string, fileId?: string): UploadResult {
  const state = code === "permission_required" || code === "permission_declined" || code === "timed_out" ? code : code === "unavailable" ? "unavailable" : "failed";
  return { ok: false, code, message, uploadId, fileId, state };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
