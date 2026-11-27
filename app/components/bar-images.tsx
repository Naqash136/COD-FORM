import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { inspectImageBytes } from "../bundles/image-bytes";
import {
  applyBarImage,
  applyFeaturedImage,
  barProductIds,
  catalogImage,
  generateComposition,
  inspectImageUpload,
  productImages,
  resolveImage,
  type ImageCatalogProduct,
} from "../bundles/images";
import type { BundleBar, ImageRef } from "../bundles/schema";

export function BarImageActions({
  bar,
  catalog,
  catalogSettled,
  onChange,
  onLoadImages,
  fileUrls,
  onFileReady,
}: {
  bar: BundleBar;
  catalog: ImageCatalogProduct[];
  catalogSettled: boolean;
  onChange: (bar: BundleBar) => void;
  onLoadImages: (productId: string, cursor: string | null) => void;
  fileUrls?: Readonly<Record<string, string | null>>;
  onFileReady?: (fileId: string, url: string) => void;
}) {
  return (
    <s-grid gridTemplateColumns="auto auto" gap="base">
      <AddImageModal bar={bar} catalog={catalog} catalogSettled={catalogSettled} onChange={onChange} onLoadImages={onLoadImages} fileUrls={fileUrls} onFileReady={onFileReady} />
      <FeaturedImageModal bar={bar} catalog={catalog} catalogSettled={catalogSettled} onChange={onChange} onLoadImages={onLoadImages} />
    </s-grid>
  );
}

function AddImageModal({
  bar,
  catalog,
  catalogSettled,
  onChange,
  onLoadImages,
  fileUrls,
  onFileReady,
}: {
  bar: BundleBar;
  catalog: ImageCatalogProduct[];
  catalogSettled: boolean;
  onChange: (bar: BundleBar) => void;
  onLoadImages: (productId: string, cursor: string | null) => void;
  fileUrls?: Readonly<Record<string, string | null>>;
  onFileReady?: (fileId: string, url: string) => void;
}) {
  const modalId = `bar-image-${bar.id}`;
  const upload = useFetcher<UploadPayload>();
  const [draft, setDraft] = useState(() => addDraft(bar));
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadId, setUploadId] = useState("");
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const handledUpload = useRef<UploadPayload | null>(null);
  const localUrlRef = useRef<string | null>(null);

  function open() {
    setDraft(addDraft(bar));
    setMessage("");
    setPhase("idle");
  }

  function discardUpload() {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    localUrlRef.current = null;
    setLocalUrl(null);
    setUploadId("");
    setPhase("idle");
  }

  function saveCatalog() {
    const applied = applyBarImage(bar, draft.image, draft.size, draft.radius);
    if (!applied.ok) {
      setMessage(applied.message);
      setPhase("failed");
      return;
    }
    onChange(applied.bar);
    discardUpload();
    setMessage("");
    hide(modalId);
  }

  function commitUpload() {
    if (!uploadId) return;
    setPhase("processing");
    setMessage("Shopify is processing the image.");
    const body = new FormData();
    body.set("intent", "commit");
    body.set("uploadId", uploadId);
    body.set("attempted", scopeAttempted() ? "1" : "0");
    upload.submit(body, { method: "post", action: "/app/bundles/images", encType: "multipart/form-data" });
  }

  function save() {
    if (phase === "ready_to_save" || phase === "timed_out") {
      commitUpload();
      return;
    }
    if (phase === "uploading" || phase === "validating" || phase === "processing") return;
    saveCatalog();
  }

  useEffect(() => {
    if (upload.state !== "idle" || !upload.data || handledUpload.current === upload.data) return;
    handledUpload.current = upload.data;
    const data = upload.data;
    if (data.code === "permission_required") {
      setPhase("permission_required");
      setMessage(data.message ?? "Uploading a new image needs permission to add files in Shopify.");
      return;
    }
    if (data.code === "permission_declined") {
      discardUpload();
      setPhase("permission_declined");
      setMessage(data.message ?? "File upload permission was declined. Catalog images still work.");
      return;
    }
    if (data.code === "ready_to_save" && data.uploadId) {
      setUploadId(data.uploadId);
      setPhase("ready_to_save");
      setMessage("The image is ready to save.");
      return;
    }
    if (data.code === "processing" && data.uploadId) {
      setUploadId(data.uploadId);
      setPhase("processing");
      setMessage(data.message ?? "Shopify is processing the image.");
      return;
    }
    if (data.code === "timed_out") {
      if (data.uploadId) setUploadId(data.uploadId);
      setPhase("timed_out");
      setMessage(data.message ?? "Shopify has not finished processing this image. Retry without uploading it again.");
      return;
    }
    if (data.code === "ready" && data.fileId && data.url) {
      const applied = applyBarImage(bar, { source: "file", fileId: data.fileId, alt: data.alt ?? "" }, draft.size, draft.radius);
      if (!applied.ok) {
        setPhase("failed");
        setMessage(applied.message);
        return;
      }
      onFileReady?.(data.fileId, data.url);
      onChange(applied.bar);
      discardUpload();
      setMessage("");
      hide(modalId);
      return;
    }
    setPhase("failed");
    setMessage(data.message || "The image was not stored.");
  }, [upload.state, upload.data, bar, draft.size, draft.radius, onChange, onFileReady, modalId]);

  async function receiveFile(file: { name: string; type: string; size: number; arrayBuffer?: () => Promise<ArrayBuffer> }) {
    const quick = inspectImageUpload(file);
    if (!quick.ok) {
      setPhase("failed");
      setMessage(quick.message);
      return;
    }
    if (!file.arrayBuffer) {
      setPhase("failed");
      setMessage("Choose an image file.");
      return;
    }
    setPhase("validating");
    setMessage("Checking the image.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectImageBytes(bytes, file.type);
    if (!inspected.ok) {
      setPhase("failed");
      setMessage(inspected.message);
      return;
    }
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const previewBytes = new Uint8Array(bytes.byteLength);
    previewBytes.set(bytes);
    const preview = URL.createObjectURL(new Blob([previewBytes], { type: inspected.image.mime }));
    localUrlRef.current = preview;
    setLocalUrl(preview);
    const alreadyAttempted = scopeAttempted();
    rememberScopeAttempt();
    const body = new FormData();
    body.set("intent", "stage");
    body.set("attemptKey", crypto.randomUUID());
    body.set("attempted", alreadyAttempted ? "1" : "0");
    body.set("file", new Blob([previewBytes], { type: inspected.image.mime }), `image.${inspected.image.extension}`);
    setPhase("uploading");
    setMessage("Uploading the image to Shopify.");
    upload.submit(body, { method: "post", action: "/app/bundles/images", encType: "multipart/form-data" });
  }

  function generate() {
    const generated = generateComposition(bar, catalog);
    if (!generated.ok) {
      setMessage(generated.message);
      return;
    }
    setDraft({ ...draft, image: generated.image, screen: "edit" });
    setMessage("Generated a composition from the product images.");
  }

  return (
    <>
      <s-button variant="secondary" commandFor={modalId} command="--show" onClick={open}>
        {bar.images.customBarImage ? "Change image" : "Add image"}
      </s-button>
      <s-modal id={modalId} heading="Add image" size="large">
        {draft.screen === "choose" ? (
          <ImageChooser
            bar={bar}
            catalog={catalog}
            catalogSettled={catalogSettled}
            pending={draft.pending}
            message={message}
            onPending={(pending) => setDraft({ ...draft, pending })}
            onLoadImages={onLoadImages}
            onGenerate={generate}
            onBack={() => {
              setDraft({ ...draft, screen: "edit", pending: draft.image });
              setMessage("");
            }}
            onSelect={() => {
              setDraft({ ...draft, image: draft.pending, screen: "edit" });
              setMessage("");
            }}
          />
        ) : (
          <>
            <div data-upload-state={phase}>
              {localUrl && phase !== "idle" && phase !== "failed" && phase !== "permission_declined" ? (
                <img src={localUrl} alt="" width={draft.size} height={draft.size} style={{ width: draft.size, height: draft.size, borderRadius: draft.radius, objectFit: "contain" }} />
              ) : (
                <ImagePreview image={draft.image} catalog={catalog} catalogSettled={catalogSettled} size={draft.size} radius={draft.radius} fileUrls={fileUrls} />
              )}
            </div>
            <s-number-field
              label="Image size"
              name={`${modalId}-size`}
              value={String(draft.size)}
              min={24}
              max={128}
              step={1}
              onChange={(event) => {
                const value = wholeNumber(event);
                if (value == null || value < 24 || value > 128) return;
                setDraft({ ...draft, size: value });
              }}
            />
            <s-number-field
              label="Border radius"
              name={`${modalId}-radius`}
              value={String(draft.radius)}
              min={0}
              max={32}
              step={1}
              onChange={(event) => {
                const value = wholeNumber(event);
                if (value == null || value < 0 || value > 32) return;
                setDraft({ ...draft, radius: value });
              }}
            />
            <s-drop-zone
              label="Image upload"
              name={`${modalId}-upload`}
              accept=".jpg,.jpeg,.png,.webp,.gif"
              onChange={(event) => {
                const file = firstFile(event);
                if (!file) return;
                void receiveFile(file);
              }}
              onDropRejected={() => {
                setPhase("failed");
                setMessage("Use a JPEG, PNG, WebP, or GIF image.");
              }}
            />
            {message ? <s-text>{message}</s-text> : null}
            <s-grid gridTemplateColumns="auto auto auto" gap="base">
              <s-button variant="secondary" onClick={() => setDraft({ ...draft, screen: "choose", pending: draft.image })}>Choose product image</s-button>
              <s-button variant="secondary" onClick={generate}>Generate image</s-button>
              <s-button variant="tertiary" tone="critical" onClick={() => setDraft({ ...draft, image: null })}>Delete image</s-button>
            </s-grid>
            {phase === "timed_out" ? <s-button variant="secondary" onClick={commitUpload}>Retry</s-button> : null}
            <s-button slot="primary-action" variant="primary" onClick={save} {...(phase === "uploading" || phase === "validating" || phase === "processing" ? { disabled: true } : {})}>Save</s-button>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              commandFor={modalId}
              command="--hide"
              onClick={() => {
                discardUpload();
                setDraft(addDraft(bar));
                setMessage("");
              }}
            >
              Cancel
            </s-button>
          </>
        )}
      </s-modal>
    </>
  );
}

function FeaturedImageModal({
  bar,
  catalog,
  catalogSettled,
  onChange,
  onLoadImages,
}: {
  bar: BundleBar;
  catalog: ImageCatalogProduct[];
  catalogSettled: boolean;
  onChange: (bar: BundleBar) => void;
  onLoadImages: (productId: string, cursor: string | null) => void;
}) {
  const modalId = `bar-featured-${bar.id}`;
  const [draft, setDraft] = useState<ImageRef | null>(bar.images.featuredImage);
  const [screen, setScreen] = useState<"home" | "pick">("home");
  const [productId, setProductId] = useState<string | null>(null);
  const [pending, setPending] = useState<ImageRef | null>(bar.images.featuredImage);
  const [message, setMessage] = useState("");
  const products = barProductIds(bar);

  function open() {
    setDraft(bar.images.featuredImage);
    setPending(bar.images.featuredImage);
    setScreen("home");
    setProductId(null);
    setMessage("");
  }

  function save() {
    const applied = applyFeaturedImage(bar, draft);
    if (!applied.ok) {
      setMessage(applied.message);
      return;
    }
    onChange(applied.bar);
    setMessage("");
    hide(modalId);
  }

  function generate() {
    const generated = generateComposition(bar, catalog);
    if (!generated.ok) {
      setMessage(generated.message);
      return;
    }
    setPending(generated.image);
    setMessage("Generated a composition from the product images.");
  }

  return (
    <>
      <s-button variant="secondary" commandFor={modalId} command="--show" onClick={open}>Featured image</s-button>
      <s-modal id={modalId} heading="Featured image" size="large">
        {screen === "pick" && productId ? (
          <ImageChooser
            bar={bar}
            catalog={catalog}
            catalogSettled={catalogSettled}
            productId={productId}
            pending={pending}
            message={message}
            onPending={setPending}
            onLoadImages={onLoadImages}
            onGenerate={generate}
            onBack={() => {
              setScreen("home");
              setMessage("");
            }}
            onSelect={() => {
              setDraft(pending);
              setScreen("home");
              setMessage("");
            }}
          />
        ) : (
          <>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <div>
              <s-text>Product</s-text>
              {products.map((id) => {
                const known = catalog.find((item) => item.id === id);
                return (
                  <s-button
                    key={id}
                    variant="tertiary"
                    onClick={() => {
                      setProductId(id);
                      setPending(draft);
                      setScreen("pick");
                      setMessage("");
                    }}
                  >
                    {known?.title || "Product"}
                  </s-button>
                );
              })}
            </div>
            <div>
              <s-text>Featured image</s-text>
              <ImagePreview image={draft} catalog={catalog} catalogSettled={catalogSettled} size={96} radius={8} />
              <s-grid gridTemplateColumns="auto auto" gap="base">
                <s-button
                  variant="secondary"
                  onClick={() => {
                    const nextProduct = productId ?? products[0] ?? null;
                    if (!nextProduct) return;
                    setProductId(nextProduct);
                    setPending(draft);
                    setScreen("pick");
                    setMessage("");
                  }}
                >
                  {draft ? "Change image" : "Select image"}
                </s-button>
                <s-button variant="tertiary" tone="critical" onClick={() => setDraft(null)}>Delete image</s-button>
              </s-grid>
              {message ? <s-text>{message}</s-text> : null}
            </div>
          </s-grid>
          <s-button slot="primary-action" variant="primary" onClick={save}>Save</s-button>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            commandFor={modalId}
            command="--hide"
            onClick={() => {
              setDraft(bar.images.featuredImage);
              setScreen("home");
              setMessage("");
            }}
          >
            Cancel
          </s-button>
          </>
        )}
      </s-modal>
    </>
  );
}

function ImageChooser({
  bar,
  catalog,
  catalogSettled,
  productId,
  pending,
  message,
  onPending,
  onLoadImages,
  onGenerate,
  onBack,
  onSelect,
}: {
  bar: BundleBar;
  catalog: ImageCatalogProduct[];
  catalogSettled: boolean;
  productId?: string;
  pending: ImageRef | null;
  message: string;
  onPending: (image: ImageRef | null) => void;
  onLoadImages: (productId: string, cursor: string | null) => void;
  onGenerate: () => void;
  onBack: () => void;
  onSelect: () => void;
}) {
  const ids = productId ? [productId] : barProductIds(bar);
  return (
    <>
      <s-button variant="tertiary" onClick={() => onPending(null)}>{pending == null ? "Selected: No image" : "No image"}</s-button>
      {ids.map((id) => {
        const product = catalog.find((item) => item.id === id);
        const images = product ? productImages(product) : [];
        return (
          <div key={id}>
            <s-text>{product ? "Product images" : "Product images are not loaded yet."}</s-text>
            {!product && catalogSettled ? <s-text>This product is no longer available.</s-text> : null}
            {product && images.length === 0 ? <s-text>Shopify has not returned an image for this product.</s-text> : null}
            {images.map((image) => {
              const choice = catalogImage(id, image.url, image.alt);
              const selected = choice != null && sameImage(pending, choice);
              return (
                <s-grid key={image.url} gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
                  <s-thumbnail src={image.url} alt={image.alt ?? "Product image"} size="small" />
                  <s-button variant={selected ? "primary" : "tertiary"} onClick={() => choice && onPending(choice)}>
                    {selected ? "Selected" : image.alt || "Product image"}
                  </s-button>
                </s-grid>
              );
            })}
            {product && product.imagesComplete === false ? (
              <>
                <s-text>Shopify has more images for this product.</s-text>
                <s-button variant="secondary" onClick={() => onLoadImages(id, product.imagesCursor ?? null)}>Load more images</s-button>
              </>
            ) : null}
          </div>
        );
      })}
      <s-grid gridTemplateColumns="auto auto auto" gap="base">
        <s-button variant="secondary" onClick={onGenerate}>Generate image</s-button>
        <s-button variant="tertiary" onClick={onBack}>Back</s-button>
        <s-button variant="primary" onClick={onSelect}>Select</s-button>
      </s-grid>
      {message ? <s-text>{message}</s-text> : null}
    </>
  );
}

function ImagePreview({
  image,
  catalog,
  catalogSettled,
  size,
  radius,
  fileUrls,
}: {
  image: ImageRef | null;
  catalog: ImageCatalogProduct[];
  catalogSettled: boolean;
  size: number;
  radius: number;
  fileUrls?: Readonly<Record<string, string | null>>;
}) {
  const resolved = resolveImage(image, catalog, catalogSettled, fileUrls);
  if (resolved.status === "empty") return <s-text>No image</s-text>;
  if (resolved.status === "unavailable") {
    const detail = resolved.reason === "file"
      ? "This Shopify file cannot be shown until file access is granted."
      : "This image is no longer available.";
    return <s-text>{detail}</s-text>;
  }
  if (resolved.status === "composition") {
    return (
      <div className="cod-offer-composition" style={{ width: size, height: size, borderRadius: radius }}>
        {resolved.items.map((item) => (
          <img key={item.url} src={item.url} alt={item.alt} />
        ))}
      </div>
    );
  }
  return <img src={resolved.url} alt={resolved.alt} width={size} height={size} style={{ width: size, height: size, borderRadius: radius, objectFit: "contain" }} />;
}

function addDraft(bar: BundleBar): {
  image: ImageRef | null;
  size: number;
  radius: number;
  screen: "edit" | "choose";
  pending: ImageRef | null;
} {
  return {
    image: bar.images.customBarImage,
    size: bar.images.barImageSize,
    radius: bar.images.barImageRadius,
    screen: "edit",
    pending: bar.images.customBarImage,
  };
}

function sameImage(left: ImageRef | null, right: ImageRef | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function wholeNumber(event: { currentTarget: EventTarget }) {
  const value = (event.currentTarget as { value?: string }).value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

type UploadPhase = "idle" | "validating" | "uploading" | "ready_to_save" | "processing" | "failed" | "timed_out" | "permission_required" | "permission_declined";

type UploadPayload = {
  ok?: boolean;
  code?: string;
  message?: string;
  uploadId?: string;
  fileId?: string;
  url?: string;
  alt?: string | null;
  state?: string;
};

const SCOPE_ATTEMPT = "cod-form-file-scope-attempted";

function scopeAttempted() {
  try {
    return sessionStorage.getItem(SCOPE_ATTEMPT) === "1";
  } catch {
    return false;
  }
}

function rememberScopeAttempt() {
  try {
    sessionStorage.setItem(SCOPE_ATTEMPT, "1");
  } catch {
    /* The permission request still proceeds when storage is blocked. */
  }
}

function firstFile(event: { currentTarget: EventTarget }) {
  const files = (event.currentTarget as { files?: ArrayLike<{ name: string; type: string; size: number; arrayBuffer?: () => Promise<ArrayBuffer> }> }).files;
  return files && files.length > 0 ? files[0] : null;
}

function hide(id: string) {
  const modal = document.getElementById(id) as { hide?: () => void } | null;
  modal?.hide?.();
}
