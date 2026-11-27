import { useEffect, useReducer, useRef, useState } from "react";
import { useBlocker, useFetcher, useNavigate } from "react-router";
import { newBarId } from "../bundles/bar-edit";
import {
  BAR_MENU,
  collectCollectionIds,
  collectProductIds,
  compareAtNote,
  createBar,
  createEditorState,
  editorReducer,
  isDirty,
  membershipsFromPages,
  previewBarCards,
  previewCountries,
  type EditorState,
  type JsonPriceBook,
  type PreviewProduct,
} from "../bundles/editor-state";
import { fileIdsInDocument, offerIndicator, previewGallery } from "../bundles/images";
import type { BundleBar, BundleDocument } from "../bundles/schema";
import { validateDocument } from "../bundles/validate";
import { BarCard } from "./bar-card";
import { MixSwapDialog } from "./mix-slots";
import { ShopifyResourceField } from "./shopify-resource-picker";
import { EditorSection } from "./editor-section";
import type { PickerResource } from "../bundles/shopify/selection";

export type EditorLoaderData = {
  offerId: string;
  status: EditorState["status"];
  document: BundleDocument;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  storefrontActive: boolean;
  codFormActive: boolean;
  countryCode: string | null;
};

type CatalogResponse = {
  requestToken: string;
  products?: PreviewProduct[];
  priceBook?: JsonPriceBook | null;
  message: string | null;
  productId?: string;
  images?: Array<{ url: string; alt: string | null }>;
  hasNextPage?: boolean;
  endCursor?: string | null;
};

type CollectionResponse = {
  requestToken: string;
  append: boolean;
  pages: EditorState["collectionPages"];
  page: EditorState["collectionPages"][number] | null;
  message: string | null;
};

type SaveResponse = {
  ok: boolean;
  intent?: "save" | "publish";
  revisionId?: string | null;
  status?: EditorState["status"];
  code?: string;
  message?: string;
  document?: BundleDocument;
};

export function BundleEditor({ offer }: { offer: EditorLoaderData }) {
  const [state, dispatch] = useReducer(editorReducer, offer, (loaded) => createEditorState({
    offerId: loaded.offerId,
    status: loaded.status,
    document: loaded.document,
    draftRevisionId: loaded.draftRevisionId,
    publishedRevisionId: loaded.publishedRevisionId,
    storefrontActive: loaded.storefrontActive,
    codFormActive: loaded.codFormActive,
    countryCode: loaded.countryCode ?? "US",
  }));
  const [openBars, setOpenBars] = useState<Record<string, boolean>>({});
  const [fileUrls, setFileUrls] = useState<Record<string, string | null>>({});
  const fileLookup = useFetcher<{ files?: Array<{ fileId: string; url: string | null; state: string }> }>();
  const dragFrom = useRef<number | null>(null);
  const catalog = useFetcher<CatalogResponse>();
  const imagePages = useFetcher<CatalogResponse>();
  const collections = useFetcher<CollectionResponse>();
  const saver = useFetcher<SaveResponse>();
  const handledSave = useRef<SaveResponse | null>(null);
  const loadCatalog = useRef(catalog.load);
  loadCatalog.current = catalog.load;
  const loadImagePage = useRef(imagePages.load);
  loadImagePage.current = imagePages.load;
  const loadCollections = useRef(collections.load);
  loadCollections.current = collections.load;
  const navigate = useNavigate();
  const dirty = isDirty(state);
  const blocker = useBlocker(dirty && !state.saving);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const leave = window.confirm("You have unsaved changes. Leave this offer without saving?");
    if (leave) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fileKey = fileIdsInDocument(state.document).sort().join(",");
  const submitFiles = useRef(fileLookup.submit);
  submitFiles.current = fileLookup.submit;
  useEffect(() => {
    if (!fileKey) return;
    const body = new FormData();
    body.set("intent", "resolve");
    body.set("fileIds", fileKey);
    body.set("attempted", "1");
    submitFiles.current(body, { method: "post", action: "/app/bundles/images", encType: "multipart/form-data" });
  }, [fileKey]);
  useEffect(() => {
    const files = fileLookup.data?.files;
    if (!files) return;
    setFileUrls((current) => {
      const next = { ...current };
      for (const file of files) next[file.fileId] = file.state === "ready" ? file.url : null;
      return next;
    });
  }, [fileLookup.data]);

  const collectionKey = collectCollectionIds(state.document).sort().join(",");
  useEffect(() => {
    const token = `collections${Date.now().toString(36)}`;
    dispatch({ type: "collectionRequested", token });
    if (!collectionKey) {
      dispatch({ type: "collectionReceived", token, pages: [] });
      return;
    }
    const params = new URLSearchParams({ collectionIds: collectionKey, token });
    loadCollections.current(`/app/bundles/collections?${params.toString()}`);
  }, [collectionKey]);

  useEffect(() => {
    if (!collections.data) return;
    if (collections.data.append && collections.data.page) {
      dispatch({ type: "collectionAppended", token: collections.data.requestToken, page: collections.data.page });
      return;
    }
    dispatch({ type: "collectionReceived", token: collections.data.requestToken, pages: collections.data.pages });
  }, [collections.data]);

  const catalogKey = catalogRequestKey(state);
  useEffect(() => {
    if (!catalogKey) return;
    const token = `preview${Date.now().toString(36)}`;
    dispatch({ type: "catalogRequested", token });
    const params = new URLSearchParams({
      productIds: catalogKey,
      country: state.previewCountry,
      token,
    });
    loadCatalog.current(`/app/bundles/catalog?${params.toString()}`);
  }, [catalogKey, state.previewCountry]);

  useEffect(() => {
    if (!catalog.data?.products) return;
    dispatch({
      type: "catalogReceived",
      token: catalog.data.requestToken,
      products: catalog.data.products,
      priceBook: catalog.data.priceBook ?? null,
      message: catalog.data.message,
    });
  }, [catalog.data]);

  function loadMoreImages(productId: string, cursor: string | null) {
    const token = `images${Date.now().toString(36)}`;
    dispatch({ type: "imagePageRequested", token });
    const params = new URLSearchParams({ imageProductId: productId, token });
    if (cursor) params.set("imageCursor", cursor);
    loadImagePage.current(`/app/bundles/catalog?${params.toString()}`);
  }

  useEffect(() => {
    const data = imagePages.data;
    if (!data?.productId || !data.images) return;
    dispatch({
      type: "productImagesAppended",
      token: data.requestToken,
      productId: data.productId,
      images: data.images,
      hasNextPage: data.hasNextPage === true,
      endCursor: data.endCursor ?? null,
    });
  }, [imagePages.data]);

  useEffect(() => {
    const result = saver.data;
    if (!result || saver.state !== "idle" || result === handledSave.current) return;
    handledSave.current = result;
    if (!result.ok || !result.revisionId || !result.document) {
      dispatch({
        type: "saveFailed",
        revisionId: typeof result.revisionId === "string" ? result.revisionId : undefined,
        document: result.document,
        notice: {
          tone: "critical",
          message: result.code === "conflict"
            ? "This offer was saved somewhere else. Reload it before saving over those changes."
            : result.message ?? "The offer could not be saved.",
        },
      });
      return;
    }
    if (result.intent === "publish") dispatch({ type: "publishSucceeded", revisionId: result.revisionId, document: result.document });
    else dispatch({ type: "saveSucceeded", revisionId: result.revisionId, document: result.document, status: result.status ?? "DRAFT" });
  }, [saver.data, saver.state]);

  function submit(intent: "save" | "publish") {
    if (intent === "publish") {
      const validated = validateDocument(state.document, "publish");
      if (!validated.ok) {
        dispatch({ type: "saveFailed", notice: { tone: "critical", message: validated.errors[0]?.message ?? "Add a complete offer before publishing." } });
        return;
      }
    }
    dispatch({ type: "saveStarted" });
    saver.submit(
      {
        intent,
        expectedDraftRevisionId: state.draftRevisionId ?? "",
        document: JSON.stringify(state.document),
      },
      { method: "post" },
    );
  }

  function addBar(type: (typeof BAR_MENU)[number]["type"]) {
    if (!state.previewProduct || state.previewProduct.id !== state.previewProductId) {
      dispatch({ type: "saveFailed", notice: { tone: "critical", message: "Choose a product and wait for Shopify to load it before adding a bar." } });
      return;
    }
    const created = createBar(type, state.previewProduct, newBarId(state.document.bars.map((bar) => bar.id)));
    if (!created.ok) {
      dispatch({ type: "saveFailed", notice: { tone: "critical", message: created.message } });
      return;
    }
    dispatch({ type: "addBar", bar: created.bar });
    setOpenBars((current) => ({ ...current, [created.bar.id]: true }));
  }

  const resources = pickerResources(state);
  const cards = previewBarCards(
    state.document,
    state.priceBook,
    state.productTitles,
    Object.fromEntries(state.document.bars.map((bar) => [bar.id, {
      quantity: state.previewQuantities[bar.id],
      variantId: state.previewVariants[bar.id],
      rows: previewRowsForBar(state, bar.id),
    }])),
    state.previewCatalog,
    membershipsFromPages(state.collectionPages, state.document),
  );
  function movePreview(key: string) {
    if (key !== "ArrowDown" && key !== "ArrowUp") return;
    const selectable = cards.filter((card) => card.selectable);
    if (selectable.length === 0) return;
    const current = selectable.findIndex((card) => card.barId === state.previewBarId);
    const start = current < 0 ? (key === "ArrowDown" ? -1 : 0) : current;
    const next = selectable[(start + (key === "ArrowDown" ? 1 : -1) + selectable.length) % selectable.length];
    if (!next) return;
    dispatch({ type: "selectPreviewBar", barId: next.barId });
  }
  const productPrice = state.previewProduct?.variants.find((variant) => variant.availableForSale) ?? state.previewProduct?.variants[0];

  return (
    <div className="cod-editor">
      <section className={state.saving ? "cod-editor-config is-saving" : "cod-editor-config"} aria-label="Bundle configuration">
        <header className="cod-editor-toolbar">
          <s-button variant="tertiary" icon="arrow-left" onClick={() => navigate("/app/bundles")}>
            Bundles & Offers
          </s-button>
          <s-text-field
            label="Bundle name"
            name="bundle-name"
            value={state.document.name}
            required
            {...(state.saving ? { disabled: true } : {})}
            onInput={(event) => {
              const value = (event.currentTarget as { value?: string }).value;
              if (typeof value === "string") dispatch({ type: "rename", name: value });
            }}
          />
          <div className="cod-editor-toolbar-status">
            <s-badge tone={state.status === "PUBLISHED" ? "success" : state.status === "INACTIVE" ? "warning" : "info"}>
              {state.status === "PUBLISHED" ? "Published" : state.status === "INACTIVE" ? "Inactive" : "Draft"}
            </s-badge>
            {dirty ? <s-text>Unsaved changes</s-text> : <s-text>All changes saved</s-text>}
            {state.saving ? <s-spinner accessibilityLabel="Saving offer" size="base" /> : null}
          </div>
          <div className="cod-actions">
            <s-button variant="secondary" {...(state.saving || !dirty ? { disabled: true } : {})} onClick={() => submit("save")}>
              Save draft
            </s-button>
            <s-button variant="primary" {...(state.saving ? { disabled: true } : {})} onClick={() => submit("publish")}>
              Publish configuration
            </s-button>
          </div>
        </header>

        {state.notice ? (
          <s-banner heading={state.notice.tone === "success" ? "Saved" : "Needs attention"} tone={state.notice.tone} dismissible onDismiss={() => dispatch({ type: "dismissNotice" })}>
            <s-text>{state.notice.message}</s-text>
          </s-banner>
        ) : null}

        <EditorSection title="Products" summary="Products this offer can use" defaultOpen>
          <ShopifyResourceField
            label="Choose products"
            purpose="product_bundle"
            resource="product"
            selection={resources}
            onChange={(selection) => dispatch({ type: "setProducts", resources: selection })}
          />
          {state.document.products.items.length === 0 ? <s-text>No products selected.</s-text> : null}
        </EditorSection>

        <EditorSection title="Settings" summary="Offer settings are added in a later stage">
          <s-text>Settings for this offer will be specified after the editor layout is approved.</s-text>
        </EditorSection>

        <EditorSection title="Style" summary="Appearance settings are added in a later stage">
          <s-text>Style controls will be specified after the editor layout is approved.</s-text>
        </EditorSection>

        <section className="cod-editor-bars">
          <div className="cod-panel-head">
            <h2 className="cod-section-title">Bundle bars</h2>
            <s-button commandFor="add-bar-menu" icon="plus" variant="primary">Add bar</s-button>
            <s-menu id="add-bar-menu" accessibilityLabel="Add a bundle bar">
              {BAR_MENU.map((item) => (
                <s-button key={item.type} icon={item.icon} variant="tertiary" commandFor="add-bar-menu" command="--hide" onClick={() => addBar(item.type)}>
                  {item.label}
                </s-button>
              ))}
            </s-menu>
          </div>
          {state.document.bars.length === 0 ? <s-text>No bars yet. Add one of the five offer types.</s-text> : null}
          {state.document.bars.map((bar, index) => (
            <BarCard
              key={bar.id}
              bar={bar}
              index={index}
              count={state.document.bars.length}
              currencyCode={state.priceBook?.currencyCode ?? null}
              catalog={state.previewCatalog}
              catalogSettled={state.catalogSettled}
              priceBook={state.priceBook}
              collectionPages={state.collectionPages}
              compareAtNote={compareAtNote(bar, state.priceBook)}
              open={openBars[bar.id] ?? false}
              onToggle={(next) => setOpenBars((current) => ({ ...current, [bar.id]: next }))}
              onChange={(next) => dispatch({ type: "replaceBar", bar: next })}
              onLoadImages={loadMoreImages}
              fileUrls={fileUrls}
              onFileReady={(fileId, url) => setFileUrls((current) => ({ ...current, [fileId]: url }))}
              onDuplicate={() => {
                const id = newBarId(state.document.bars.map((item) => item.id));
                dispatch({ type: "duplicateBar", barId: bar.id, id });
                setOpenBars((current) => ({ ...current, [id]: true }));
              }}
              onDelete={() => {
                const label = bar.title || BAR_MENU.find((item) => item.type === bar.type)?.label || "this bar";
                if (!window.confirm(`Delete ${label}?`)) return;
                dispatch({ type: "deleteBar", barId: bar.id });
              }}
              onMove={(to) => dispatch({ type: "reorderBars", from: index, to })}
              onDragStart={() => {
                dragFrom.current = index;
              }}
              onDrop={() => {
                if (dragFrom.current == null) return;
                dispatch({ type: "reorderBars", from: dragFrom.current, to: index });
                dragFrom.current = null;
              }}
            />
          ))}
        </section>
      </section>

      <aside className="cod-editor-preview" aria-label="Live preview">
        <div className="cod-panel">
          <h2 className="cod-section-title">Preview</h2>
          <s-select
            label="Product"
            name="preview-product"
            value={state.previewProductId ?? ""}
            onChange={(event) => {
              const value = (event.currentTarget as { value?: string }).value;
              if (typeof value === "string") dispatch({ type: "selectPreviewProduct", productId: value });
            }}
          >
            <s-option value="">Choose a product</s-option>
            {state.document.products.items.map((item) => (
              <s-option key={item.id} value={item.product.productId}>
                {state.productTitles[item.product.productId] ?? "Selected product"}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Country"
            name="preview-country"
            value={state.previewCountry}
            onChange={(event) => {
              const value = (event.currentTarget as { value?: string }).value;
              if (typeof value === "string") dispatch({ type: "selectPreviewCountry", countryCode: value });
            }}
          >
            {previewCountries(offer.countryCode).map((country) => (
              <s-option key={country} value={country}>{country}</s-option>
            ))}
          </s-select>

          {!state.previewProductId ? <s-text>Choose a product to preview this offer.</s-text> : null}
          {catalog.state === "loading" ? <s-spinner accessibilityLabel="Loading product" size="base" /> : null}
          {state.previewMessage ? <s-banner tone="warning" heading="Preview unavailable"><s-text>{state.previewMessage}</s-text></s-banner> : null}
          {state.previewProduct ? (
            <div className="cod-editor-product" data-gallery-mode={previewGallery(state.previewProduct, state.document.bars.find((bar) => bar.id === state.previewBarId) ?? null, state.previewCatalog, state.catalogSettled, fileUrls).mode}>
              <GalleryImage
                product={state.previewProduct}
                bar={state.document.bars.find((bar) => bar.id === state.previewBarId) ?? null}
                catalog={state.previewCatalog}
                settled={state.catalogSettled}
                fileUrls={fileUrls}
              />
              <div>
                <h3 className="cod-section-title">{state.previewProduct.title}</h3>
                <s-text>
                  {productPrice?.regularLabel
                    ? `${productPrice.regularLabel}${productPrice.compareLabel ? ` Compare at ${productPrice.compareLabel}` : ""}`
                    : "Price unavailable"}
                </s-text>
              </div>
            </div>
          ) : null}

          <div className="cod-editor-offers" role="radiogroup" aria-label="Bundle offers" tabIndex={0} onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const target = event.target as HTMLElement;
            if (target.closest("s-number-field, s-select, s-button, input, select, button")) return;
            event.preventDefault();
            movePreview(event.key);
          }}>
            {cards.map((card) => {
              const selected = card.barId === state.previewBarId;
              const style = card.presentation ? {
                opacity: card.presentation.opacity / 100,
                backgroundColor: card.presentation.backgroundColor,
                color: card.presentation.textColor,
                fontSize: `${card.presentation.fontSize}px`,
              } : undefined;
              const focusable = card.selectable && (selected || (!state.previewBarId && card.barId === cards.find((item) => item.selectable)?.barId));
              const configured = state.document.bars.find((bar) => bar.id === card.barId);
              const indicator = configured ? offerIndicator(configured, state.previewCatalog, state.catalogSettled, fileUrls) : { kind: "radio" as const };
              return (
                <div
                  key={card.barId}
                  className={selected ? "cod-offer is-selected" : "cod-offer"}
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={!card.selectable}
                  tabIndex={focusable ? 0 : -1}
                  style={style}
                  onClick={(event) => {
                    if (!card.selectable) return;
                    const target = event.target as HTMLElement;
                    if (target.closest("s-number-field, s-select, s-button, input, select, button")) return;
                    dispatch({ type: "selectPreviewBar", barId: card.barId });
                  }}
                  onKeyDown={(event) => {
                    if (!card.selectable || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    dispatch({ type: "selectPreviewBar", barId: card.barId });
                  }}
                >
                  <div className="cod-offer-main">
                    <OfferMark indicator={indicator} />
                    <div className="cod-offer-copy">
                  {card.soldOut && card.presentation ? <strong>{card.presentation.label}</strong> : null}
                  {card.label ? <s-text>{card.label}</s-text> : null}
                  <strong>{card.title}</strong>
                  {card.subtitle ? <s-text>{card.subtitle}</s-text> : null}
                  {card.text ? <s-text>{card.text}</s-text> : null}
                  {selected && card.quantitySelector ? (
                    <>
                      <s-number-field
                        label="Quantity"
                        name={`preview-quantity-${card.barId}`}
                        value={String(card.quantity)}
                        min={1}
                        max={999}
                        step={1}
                        onChange={(event) => {
                          const value = previewQuantity(event);
                          if (value == null) return;
                          dispatch({ type: "setPreviewQuantity", barId: card.barId, quantity: value });
                        }}
                      />
                    </>
                  ) : null}
                  {selected && card.variants.filter((variant) => variant.available).length > 1 ? (
                    <>
                      <s-select
                        label="Variant"
                        name={`preview-variant-${card.barId}`}
                        value={card.variantId ?? ""}
                        onChange={(event) => {
                          const value = (event.currentTarget as { value?: string }).value;
                          if (typeof value === "string" && value) dispatch({ type: "setPreviewVariant", barId: card.barId, variantId: value });
                        }}
                      >
                        {card.variants.filter((variant) => variant.available).map((variant) => (
                          <s-option key={variant.id} value={variant.id}>{variant.title}</s-option>
                        ))}
                      </s-select>
                    </>
                  ) : null}
                  {(!card.showOnlyWhenSelected || selected) && card.products.length > 0 ? (
                    <div className={card.layout === "horizontal" ? "cod-bundle-products is-horizontal" : "cod-bundle-products"}>
                      {card.products.map((product) => {
                        const imageUrl = product.imageUrl ?? undefined;
                        const imageAlt = product.imageAlt || "Product";
                        return (
                        <div key={product.rowId} className="cod-bundle-product">
                          {imageUrl ? <s-thumbnail src={imageUrl} alt={imageAlt} size="small" /> : null}
                          <s-text>{product.title}</s-text>
                          {product.quantitySelector ? (
                            <s-number-field
                              label="Quantity"
                              name={`preview-row-quantity-${card.barId}-${product.rowId}`}
                              value={String(product.quantity)}
                              min={1}
                              max={999}
                              step={1}
                              onChange={(event) => {
                                const value = previewQuantity(event);
                                if (value == null) return;
                                dispatch({ type: "setPreviewRowQuantity", barId: card.barId, rowId: product.rowId, quantity: value });
                              }}
                            />
                          ) : null}
                          {product.variants.filter((variant) => variant.available).length > 1 ? (
                            <s-select
                              label="Variant"
                              name={`preview-row-variant-${card.barId}-${product.rowId}`}
                              value={product.variantId ?? ""}
                              onChange={(event) => {
                                const value = (event.currentTarget as { value?: string }).value;
                                if (typeof value === "string" && value) dispatch({ type: "setPreviewRowVariant", barId: card.barId, rowId: product.rowId, variantId: value });
                              }}
                            >
                              {product.variants.filter((variant) => variant.available).map((variant) => (
                                <s-option key={variant.id} value={variant.id}>{variant.title}</s-option>
                              ))}
                            </s-select>
                          ) : null}
                          {selected && product.canSwap && card.changeButtonLabel ? (
                            <s-button variant="tertiary" commandFor={`mix-swap-${card.barId}-${product.rowId}`} command="--show">{card.changeButtonLabel}</s-button>
                          ) : null}
                          {!card.hideIndividualPrice && product.final ? <s-text>{product.final} {card.price.ok ? card.price.currency : ""}</s-text> : null}
                          {!card.hideIndividualPrice && product.compareAt ? <s-text>Compare at {product.compareAt}</s-text> : null}
                        </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {card.price.ok ? (
                    <>
                      <s-text>{card.price.final} {card.price.currency}</s-text>
                      {card.price.compareAt ? <s-text>Compare at {card.price.compareAt}</s-text> : <s-text>Regular {card.price.regular} {card.price.currency}</s-text>}
                      <s-text>Save {card.price.savings} {card.price.currency} ({card.price.savedPercentage})</s-text>
                    </>
                  ) : (
                    <s-text>{card.price.message}</s-text>
                  )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {state.previewBarId ? null : <s-text>Select an offer to preview it. This does not change the saved default.</s-text>}
          {state.document.bars.flatMap((bar) => {
            if (bar.type !== "mix_and_match" || bar.id !== state.previewBarId) return [];
            return bar.config.slots.filter((slot) => slot.swapProducts.length > 0 || slot.swapCollectionIds.length > 0).map((slot) => (
              <MixSwapDialog
                key={`${bar.id}-${slot.id}`}
                modalId={`mix-swap-${bar.id}-${slot.id}`}
                heading={bar.config.selectionModal.title}
                slot={slot}
                catalog={state.previewCatalog}
                pages={state.collectionPages}
                priceBook={state.priceBook}
                titles={state.productTitles}
                onChoose={(variantId) => dispatch({ type: "setPreviewRowVariant", barId: bar.id, rowId: slot.id, variantId })}
              />
            ));
          })}
          {state.collectionPages.filter((page) => page.hasNextPage).map((page) => (
            <s-button
              key={page.collectionId}
              variant="tertiary"
              onClick={() => {
                if (!page.endCursor) return;
                const params = new URLSearchParams({
                  collectionId: page.collectionId,
                  cursor: page.endCursor,
                  token: state.collectionToken,
                });
                loadCollections.current(`/app/bundles/collections?${params.toString()}`);
              }}
            >
              Load more from {page.title}
            </s-button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function previewQuantity(event: { currentTarget: EventTarget }) {
  const value = (event.currentTarget as { value?: string }).value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  if (quantity < 1 || quantity > 999) return null;
  return quantity;
}

function previewRowsForBar(state: EditorState, barId: string) {
  const rows: Record<string, { quantity?: number; variantId?: string }> = {};
  const prefix = `${barId}:`;
  for (const [key, value] of Object.entries(state.previewRows)) {
    if (key.startsWith(prefix)) rows[key.slice(prefix.length)] = value;
  }
  return rows;
}

function GalleryImage({
  product,
  bar,
  catalog,
  settled,
  fileUrls,
}: {
  product: PreviewProduct;
  bar: BundleBar | null;
  catalog: PreviewProduct[];
  settled: boolean;
  fileUrls?: Readonly<Record<string, string | null>>;
}) {
  const gallery = previewGallery(product, bar, catalog, settled, fileUrls);
  if (gallery.composition) {
    return (
      <div className="cod-gallery-composition" aria-hidden="true">
        {gallery.composition.map((item) => <img key={item.url} src={item.url} alt="" />)}
      </div>
    );
  }
  if (!gallery.url) return null;
  return <s-thumbnail src={gallery.url} alt={gallery.alt} size="large" />;
}

function OfferMark({ indicator }: { indicator: ReturnType<typeof offerIndicator> }) {
  if (indicator.kind === "image") {
    return (
      <img
        className="cod-offer-image"
        src={indicator.url}
        alt=""
        aria-hidden="true"
        width={indicator.size}
        height={indicator.size}
        style={{ width: indicator.size, height: indicator.size, borderRadius: indicator.radius, objectFit: "contain" }}
      />
    );
  }
  if (indicator.kind === "composition") {
    return (
      <div className="cod-offer-composition" aria-hidden="true" style={{ width: indicator.size, height: indicator.size, borderRadius: indicator.radius }}>
        {indicator.items.map((item) => <img key={item.url} src={item.url} alt="" />)}
      </div>
    );
  }
  return <span className="cod-offer-radio" aria-hidden="true" />;
}

function catalogRequestKey(state: EditorState) {
  const ids = new Set(collectProductIds(state.document));
  if (state.previewProductId) ids.add(state.previewProductId);
  for (const page of state.collectionPages) {
    for (const product of page.products) ids.add(product.id);
  }
  return [...ids].sort().join(",");
}

function pickerResources(state: EditorState): PickerResource[] {
  return state.document.products.items.map((item) => ({
    id: item.product.productId,
    title: state.productTitles[item.product.productId] ?? "Selected product",
    variants: item.product.allowedVariantIds.map((id) => ({ id, title: id })),
  }));
}
