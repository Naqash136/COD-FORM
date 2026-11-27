import { duplicateBar, moveBar } from "./bar-edit";
import { emptyBarImages } from "./images";
import { formatDecimal, promotionalCompareAt, type Money } from "./money";
import { quoteDocument } from "./pricing";
import type { BarSelection, DealQuote, PriceBook, VerifiedCollectionMembership } from "./pricing";
import { barSelectable, readSoldOutPresentation, soldOutEnabled } from "./sold-out";
import { SCHEMA_VERSION, type BundleBar, type BundleDocument, type CatalogProduct, type MixSlot, type VariantSelection } from "./schema";
import { isProductGid, isVariantGid } from "./shopify/ids";
import type { PickerResource } from "./shopify/selection";
import { customerFacingSavings, moneyLabel, resolveTemplate, savedPercentageLabel, type TemplateValues } from "./text";

export const BAR_MENU = [
  { type: "quantity_break", label: "Quantity break", icon: "hashtag" },
  { type: "buy_x_get_y", label: "Buy X, get Y", icon: "gift-card" },
  { type: "product_bundle", label: "Product bundle", icon: "package" },
  { type: "mix_and_match", label: "Mix & Match", icon: "refresh" },
  { type: "alternative_product", label: "Alternative product", icon: "product" },
] as const;

export type BarMenuType = (typeof BAR_MENU)[number]["type"];

export type PreviewVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  regularLabel: string | null;
  compareLabel: string | null;
};

export type PreviewProduct = {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNKNOWN";
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  images?: Array<{ url: string; alt: string | null }>;
  imagesComplete?: boolean;
  imagesCursor?: string | null;
  variantsComplete: boolean;
  variants: PreviewVariant[];
};

export type CollectionPage = {
  collectionId: string;
  title: string;
  products: PreviewProduct[];
  hasNextPage: boolean;
  endCursor: string | null;
};

export type JsonMoney = {
  amountMinor: string;
  currencyCode: string;
  exponent: number;
};

export type JsonPriceBook = {
  currencyCode: string;
  variants: Record<string, { regular: JsonMoney | null; compareAt: JsonMoney | null; available: boolean }>;
};

export type EditorNotice = {
  tone: "success" | "critical" | "info";
  message: string;
};

export type EditorState = {
  offerId: string;
  status: "DRAFT" | "PUBLISHED" | "INACTIVE";
  document: BundleDocument;
  savedDocument: BundleDocument;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  storefrontActive: boolean;
  codFormActive: boolean;
  productTitles: Record<string, string>;
  previewProductId: string | null;
  previewCountry: string;
  previewBarId: string | null;
  previewTouched: boolean;
  previewQuantities: Record<string, number>;
  previewVariants: Record<string, string>;
  previewRows: Record<string, { quantity?: number; variantId?: string }>;
  previewCatalog: PreviewProduct[];
  catalogSettled: boolean;
  imageToken: string;
  catalogToken: string;
  collectionToken: string;
  collectionPages: CollectionPage[];
  previewProduct: PreviewProduct | null;
  priceBook: JsonPriceBook | null;
  previewMessage: string | null;
  saving: boolean;
  notice: EditorNotice | null;
};

export function emptyDocument(name = "Untitled bundle"): BundleDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    products: { items: [] },
    settings: { extensions: null },
    style: { extensions: null },
    bars: [],
    modal: { extensions: null },
    targeting: { productIds: [], collectionIds: [] },
    extensions: null,
  };
}

export function isDirty(state: Pick<EditorState, "document" | "savedDocument">) {
  return JSON.stringify(state.document) !== JSON.stringify(state.savedDocument);
}

export function createEditorState(input: {
  offerId: string;
  status: EditorState["status"];
  document: BundleDocument;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  storefrontActive: boolean;
  codFormActive: boolean;
  countryCode: string;
}): EditorState {
  const document = input.document;
  return {
    offerId: input.offerId,
    status: input.status,
    document,
    savedDocument: document,
    draftRevisionId: input.draftRevisionId,
    publishedRevisionId: input.publishedRevisionId,
    storefrontActive: input.storefrontActive,
    codFormActive: input.codFormActive,
    productTitles: {},
    previewProductId: document.products.items[0]?.product.productId ?? null,
    previewCountry: normalizeCountry(input.countryCode),
    previewBarId: eligibleDefaultId(document),
    previewTouched: false,
    previewQuantities: {},
    previewVariants: {},
    previewRows: {},
    previewCatalog: [],
    catalogSettled: false,
    imageToken: "",
    catalogToken: "",
    collectionToken: "",
    collectionPages: [],
    previewProduct: null,
    priceBook: null,
    previewMessage: null,
    saving: false,
    notice: null,
  };
}

type EditorAction =
  | { type: "rename"; name: string }
  | { type: "setProducts"; resources: PickerResource[] }
  | { type: "addBar"; bar: BundleBar }
  | { type: "replaceBar"; bar: BundleBar }
  | { type: "duplicateBar"; barId: string; id: string }
  | { type: "deleteBar"; barId: string }
  | { type: "reorderBars"; from: number; to: number }
  | { type: "selectPreviewProduct"; productId: string }
  | { type: "selectPreviewCountry"; countryCode: string }
  | { type: "selectPreviewBar"; barId: string | null }
  | { type: "setPreviewQuantity"; barId: string; quantity: number }
  | { type: "setPreviewVariant"; barId: string; variantId: string }
  | { type: "setPreviewRowQuantity"; barId: string; rowId: string; quantity: number }
  | { type: "setPreviewRowVariant"; barId: string; rowId: string; variantId: string }
  | { type: "catalogRequested"; token: string }
  | { type: "catalogReceived"; token: string; products: PreviewProduct[]; priceBook: JsonPriceBook | null; message: string | null }
  | { type: "imagePageRequested"; token: string }
  | { type: "productImagesAppended"; token: string; productId: string; images: Array<{ url: string; alt: string | null }>; hasNextPage: boolean; endCursor: string | null }
  | { type: "collectionRequested"; token: string }
  | { type: "collectionReceived"; token: string; pages: CollectionPage[] }
  | { type: "collectionAppended"; token: string; page: CollectionPage }
  | { type: "saveStarted" }
  | { type: "saveSucceeded"; revisionId: string; document: BundleDocument; status: EditorState["status"] }
  | { type: "publishSucceeded"; revisionId: string; document: BundleDocument }
  | { type: "saveFailed"; notice: EditorNotice; revisionId?: string; document?: BundleDocument }
  | { type: "dismissNotice" };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "rename":
      return { ...state, document: { ...state.document, name: action.name.slice(0, 120) }, notice: null };
    case "setProducts": {
      const catalog = catalogFromPicker(action.resources);
      if (!catalog.ok) return { ...state, notice: { tone: "critical", message: catalog.message } };
      const titles = { ...state.productTitles };
      for (const resource of action.resources) titles[resource.id] = resource.title;
      const previewProductId = catalog.items.some((item) => item.product.productId === state.previewProductId)
        ? state.previewProductId
        : catalog.items[0]?.product.productId ?? null;
      return {
        ...state,
        document: { ...state.document, products: { items: catalog.items } },
        productTitles: titles,
        previewProductId,
        previewProduct: previewProductId === state.previewProductId ? state.previewProduct : null,
        priceBook: previewProductId === state.previewProductId ? state.priceBook : null,
        notice: null,
      };
    }
    case "addBar":
      return { ...state, document: { ...state.document, bars: [...state.document.bars, action.bar] }, notice: null };
    case "replaceBar": {
      const bars = withExclusiveDefault(state.document.bars, action.bar);
      const document = { ...state.document, bars };
      return {
        ...state,
        document,
        previewBarId: nextPreviewBar(state, document),
        previewVariants: sanitizeAlternativePreview(state.previewVariants, document, state.priceBook),
        previewRows: sanitizePreviewRows(state.previewRows, document, membershipsFromPages(state.collectionPages, document)),
        notice: null,
      };
    }
    case "duplicateBar": {
      const source = state.document.bars.find((bar) => bar.id === action.barId);
      if (!source || state.document.bars.some((bar) => bar.id === action.id)) return state;
      const copy = duplicateBar(source, action.id);
      const index = state.document.bars.findIndex((bar) => bar.id === action.barId);
      const bars = state.document.bars.slice();
      bars.splice(index + 1, 0, copy);
      return { ...state, document: { ...state.document, bars }, notice: null };
    }
    case "deleteBar": {
      const bars = state.document.bars.filter((bar) => bar.id !== action.barId);
      const document = { ...state.document, bars };
      const previewBarId = state.previewBarId === action.barId ? null : nextPreviewBar(state, document);
      return { ...state, document, previewBarId, notice: null };
    }
    case "reorderBars":
      return {
        ...state,
        document: { ...state.document, bars: moveBar(state.document.bars, action.from, action.to) },
        notice: null,
      };
    case "selectPreviewProduct":
      return {
        ...state,
        previewProductId: action.productId || null,
        previewProduct: null,
        priceBook: null,
        previewMessage: null,
      };
    case "selectPreviewCountry":
      return { ...state, previewCountry: normalizeCountry(action.countryCode), previewProduct: null, priceBook: null, previewMessage: null };
    case "selectPreviewBar": {
      if (action.barId) {
        const bar = state.document.bars.find((item) => item.id === action.barId);
        if (!bar || !barSelectable(bar)) return state;
      }
      return { ...state, previewBarId: action.barId, previewTouched: true };
    }
    case "setPreviewQuantity": {
      if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > 999) return state;
      const bar = state.document.bars.find((item) => item.id === action.barId);
      if (!bar || bar.type !== "quantity_break" || !bar.config.quantitySelector) return state;
      return { ...state, previewQuantities: { ...state.previewQuantities, [action.barId]: action.quantity } };
    }
    case "setPreviewVariant": {
      const bar = state.document.bars.find((item) => item.id === action.barId);
      const point = state.priceBook?.variants[action.variantId];
      const allowed = bar?.type === "quantity_break" || bar?.type === "buy_x_get_y" || bar?.type === "alternative_product" ? bar.config.product.allowedVariantIds : null;
      if (!allowed?.includes(action.variantId) || !point?.available) return state;
      return { ...state, previewVariants: { ...state.previewVariants, [action.barId]: action.variantId } };
    }
    case "setPreviewRowQuantity": {
      if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > 999) return state;
      const bar = state.document.bars.find((item) => item.id === action.barId);
      const row = bar?.type === "product_bundle" ? bar.config.products.find((product) => product.id === action.rowId) : null;
      if (!row?.quantitySelector) return state;
      const key = `${action.barId}:${action.rowId}`;
      return { ...state, previewRows: { ...state.previewRows, [key]: { ...state.previewRows[key], quantity: action.quantity } } };
    }
    case "setPreviewRowVariant": {
      const bar = state.document.bars.find((item) => item.id === action.barId);
      const point = state.priceBook?.variants[action.variantId];
      const key = `${action.barId}:${action.rowId}`;
      if (bar?.type === "product_bundle") {
        const row = bar.config.products.find((product) => product.id === action.rowId);
        if (!row?.product.allowedVariantIds.includes(action.variantId) || !point?.available) return state;
        return { ...state, previewRows: { ...state.previewRows, [key]: { ...state.previewRows[key], variantId: action.variantId } } };
      }
      if (bar?.type === "mix_and_match") {
        const slot = bar.config.slots.find((item) => item.id === action.rowId);
        const allowed = slot ? slotAllowsVariant(slot, action.variantId, membershipsFromPages(state.collectionPages, state.document)) : false;
        if (!slot || !allowed || (point != null && !point.available)) return state;
        return { ...state, previewRows: { ...state.previewRows, [key]: { variantId: action.variantId } } };
      }
      return state;
    }
    case "collectionRequested":
      return { ...state, collectionToken: action.token };
    case "collectionReceived": {
      if (action.token !== state.collectionToken) return state;
      const document = state.document;
      return {
        ...state,
        collectionPages: action.pages,
        previewRows: sanitizePreviewRows(state.previewRows, document, membershipsFromPages(action.pages, document)),
      };
    }
    case "collectionAppended": {
      if (action.token !== state.collectionToken) return state;
      const pages = state.collectionPages.map((page) => page.collectionId === action.page.collectionId ? {
        ...page,
        products: dedupeProducts([...page.products, ...action.page.products]),
        hasNextPage: action.page.hasNextPage,
        endCursor: action.page.endCursor,
      } : page);
      return {
        ...state,
        collectionPages: pages,
        previewRows: sanitizePreviewRows(state.previewRows, state.document, membershipsFromPages(pages, state.document)),
      };
    }
    case "catalogRequested":
      return { ...state, catalogToken: action.token, previewMessage: null };
    case "catalogReceived": {
      if (action.token !== state.catalogToken) return state;
      const titles = { ...state.productTitles };
      for (const product of action.products) titles[product.id] = product.title;
      const previewProduct = action.products.find((product) => product.id === state.previewProductId) ?? null;
      return {
        ...state,
        previewCatalog: action.products,
        catalogSettled: true,
        previewProduct,
        priceBook: action.priceBook,
        previewMessage: action.message,
        productTitles: titles,
        previewVariants: sanitizeAlternativePreview(state.previewVariants, state.document, action.priceBook),
      };
    }
    case "imagePageRequested":
      return { ...state, imageToken: action.token };
    case "productImagesAppended": {
      if (action.token !== state.imageToken) return state;
      const previewCatalog = state.previewCatalog.map((product) => {
        if (product.id !== action.productId) return product;
        const images = [...(product.images ?? [])];
        for (const image of action.images) {
          if (image.url && !images.some((item) => item.url === image.url)) images.push(image);
        }
        return { ...product, images, imagesComplete: !action.hasNextPage, imagesCursor: action.endCursor };
      });
      const previewProduct = previewCatalog.find((product) => product.id === state.previewProductId) ?? state.previewProduct;
      return { ...state, previewCatalog, previewProduct };
    }
    case "saveStarted":
      return { ...state, saving: true, notice: null };
    case "saveSucceeded":
      return {
        ...state,
        saving: false,
        document: action.document,
        savedDocument: action.document,
        draftRevisionId: action.revisionId,
        status: action.status,
        notice: { tone: "success", message: "Draft saved." },
      };
    case "publishSucceeded":
      return {
        ...state,
        saving: false,
        document: action.document,
        savedDocument: action.document,
        draftRevisionId: action.revisionId,
        publishedRevisionId: action.revisionId,
        status: "PUBLISHED",
        storefrontActive: false,
        codFormActive: false,
        notice: { tone: "success", message: "Configuration published. It is not active on the storefront or COD Form." },
      };
    case "saveFailed":
      if (!action.revisionId || !action.document) return { ...state, saving: false, notice: action.notice };
      return {
        ...state,
        saving: false,
        notice: action.notice,
        draftRevisionId: action.revisionId,
        document: action.document,
        savedDocument: action.document,
      };
    case "dismissNotice":
      return { ...state, notice: null };
    default:
      return state;
  }
}

export function catalogFromPicker(resources: PickerResource[]): { ok: true; items: CatalogProduct[] } | { ok: false; message: string } {
  const items: CatalogProduct[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!isProductGid(resource.id)) return { ok: false, message: "Choose a Shopify product." };
    if (seen.has(resource.id)) continue;
    seen.add(resource.id);
    const allowedVariantIds = resource.variants.map((variant) => variant.id).filter((id) => isVariantGid(id));
    if (allowedVariantIds.length === 0) return { ok: false, message: "Choose a product variant before adding the product." };
    items.push({
      id: catalogItemId(resource.id),
      product: { productId: resource.id, allowedVariantIds, selectedVariantId: allowedVariantIds[0] },
    });
  }
  return { ok: true, items };
}

export function createBar(type: BarMenuType, product: PreviewProduct, id: string): { ok: true; bar: BundleBar } | { ok: false; message: string } {
  if (!product.variantsComplete) {
    return { ok: false, message: "Shopify did not return every variant, so this bar was not added." };
  }
  const selection = selectionFromPreview(product);
  if (!selection) return { ok: false, message: "This product has no available variant to preselect." };
  const label = BAR_MENU.find((item) => item.type === type)?.label ?? "Offer";
  const base = barBase(id, label);
  if (type === "quantity_break") {
    return { ok: true, bar: { ...base, type, pricing: { mode: "full_price" }, config: { product: selection, quantity: 1, quantitySelector: false } } };
  }
  if (type === "buy_x_get_y") {
    return {
      ok: true,
      bar: {
        ...base,
        type,
        pricing: { mode: "full_price" },
        config: {
          product: selection,
          buyQuantity: 1,
          getQuantity: 1,
          getPricing: { mode: "percentage_off", basisPoints: 0, scope: "per_line" },
          getProduct: null,
        },
      },
    };
  }
  if (type === "product_bundle") {
    return {
      ok: true,
      bar: {
        ...base,
        type,
        config: {
          layout: "vertical",
          hideIndividualPrice: false,
          showOnlyWhenSelected: false,
          products: [{
            id: `${id}p`,
            role: "default",
            product: selection,
            quantity: 1,
            quantitySelector: false,
            pricing: { mode: "full_price" },
          }],
        },
      },
    };
  }
  if (type === "mix_and_match") {
    return {
      ok: true,
      bar: {
        ...base,
        type,
        title: "Bundle & Save",
        subtitle: "Save {{saved_amount}}",
        pricing: { mode: "percentage_off", basisPoints: 1500, scope: "per_deal" },
        config: {
          showPrices: true,
          showOnlyWhenSelected: false,
          changeButtonLabel: "Change",
          selectionModal: { title: "Select product" },
          slots: [{
            id: `${id}s`,
            role: "default",
            title: "{{product}}",
            product: selection,
            swapProducts: [],
            swapCollectionIds: [],
          }],
        },
      },
    };
  }
  return { ok: true, bar: { ...base, title: "{{product}}", type: "alternative_product", pricing: { mode: "full_price" }, config: { product: selection, quantity: 1 } } };
}

export function collectProductIds(document: BundleDocument) {
  const ids = new Set<string>();
  for (const item of document.products.items) ids.add(item.product.productId);
  for (const bar of document.bars) {
    if (bar.type === "quantity_break" || bar.type === "alternative_product") ids.add(bar.config.product.productId);
    if (bar.type === "buy_x_get_y") {
      ids.add(bar.config.product.productId);
      if (bar.config.getProduct) ids.add(bar.config.getProduct.productId);
    }
    if (bar.type === "product_bundle") {
      for (const product of bar.config.products) ids.add(product.product.productId);
    }
    if (bar.type === "mix_and_match") {
      for (const slot of bar.config.slots) {
        ids.add(slot.product.productId);
        for (const swap of slot.swapProducts) ids.add(swap.productId);
      }
    }
  }
  return [...ids].filter((id) => isProductGid(id));
}

export type BarPreview = {
  barId: string;
  title: string;
  subtitle: string;
  label: string;
  text: string;
  selectable: boolean;
  soldOut: boolean;
  presentation: ReturnType<typeof readSoldOutPresentation> | null;
  quantitySelector: boolean;
  quantity: number;
  variantId: string | null;
  variants: Array<{ id: string; title: string; available: boolean }>;
  layout: "horizontal" | "vertical" | null;
  hideIndividualPrice: boolean;
  showOnlyWhenSelected: boolean;
  changeButtonLabel: string;
  products: PreviewBundleProduct[];
  price: { ok: true; currency: string; final: string; regular: string; compareAt: string | null; savings: string; savedPercentage: string } | { ok: false; message: string };
};

export type PreviewBundleProduct = {
  rowId: string;
  role: "default" | "additional";
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  quantity: number;
  quantitySelector: boolean;
  variantId: string | null;
  variants: Array<{ id: string; title: string; available: boolean }>;
  final: string | null;
  compareAt: string | null;
  canSwap: boolean;
};

export type PreviewChoice = {
  quantity?: number;
  variantId?: string;
  rows?: Record<string, { quantity?: number; variantId?: string }>;
};

export function previewBarCards(
  document: BundleDocument,
  book: JsonPriceBook | null,
  titles: Record<string, string>,
  choices: Record<string, PreviewChoice> = {},
  catalog: PreviewProduct[] = [],
  memberships: VerifiedCollectionMembership[] = [],
): BarPreview[] {
  const priced = book ? priceBookFromJson(book) : null;
  return document.bars.map((bar) => {
    const choice = choices[bar.id];
    const quote = !priced || !priced.ok ? null : quoteDocument(document, { bars: [selectionFor(bar, choice)] }, priced.book, { memberships });
    const values = templateValues(bar, quote && quote.ok ? quote.quote : null, titles);
    const enabled = soldOutEnabled(bar);
    const variants = previewVariants(bar, book, catalog);
    return {
      barId: bar.id,
      title: resolveTemplate(bar.title, values),
      subtitle: resolveTemplate(bar.subtitle, values),
      label: resolveTemplate(bar.label, values),
      text: resolveTemplate(bar.textTemplate, values),
      selectable: barSelectable(bar),
      soldOut: enabled,
      presentation: enabled ? readSoldOutPresentation(bar.extensions) : null,
      quantitySelector: bar.type === "quantity_break" && bar.config.quantitySelector,
      quantity: quote && quote.ok ? Number(values.quantity) : configuredQuantity(bar),
      variantId: bar.type === "quantity_break" || bar.type === "buy_x_get_y" || bar.type === "alternative_product" ? choice?.variantId ?? bar.config.product.selectedVariantId : null,
      variants,
      layout: bar.type === "product_bundle" ? bar.config.layout : null,
      hideIndividualPrice: bar.type === "product_bundle" ? bar.config.hideIndividualPrice : bar.type === "mix_and_match" ? !bar.config.showPrices : false,
      showOnlyWhenSelected: bar.type === "product_bundle" || bar.type === "mix_and_match" ? bar.config.showOnlyWhenSelected : false,
      changeButtonLabel: bar.type === "mix_and_match" ? bar.config.changeButtonLabel : "",
      products: bar.type === "mix_and_match"
        ? mixProducts(bar, quote && quote.ok ? quote.quote : null, choice, book, titles, catalog, memberships, values)
        : bundleProducts(bar, quote && quote.ok ? quote.quote : null, choice, book, titles, catalog),
      price: quote && quote.ok ? priceSummary(quote.quote) : { ok: false, message: !book ? "Product pricing is not available yet." : priced && !priced.ok ? priced.message : quote && !quote.ok ? quote.errors[0]?.message ?? "This offer cannot be priced." : "This offer cannot be priced." },
    };
  });
}

export function compareAtNote(bar: BundleBar, book: JsonPriceBook | null) {
  if (bar.type !== "quantity_break" && bar.type !== "buy_x_get_y" && bar.type !== "alternative_product") return "";
  const point = book?.variants[bar.config.product.selectedVariantId];
  const money = promotionalCompareAt(point?.compareAt ? moneyFromJson(point.compareAt) : null, point?.regular ? moneyFromJson(point.regular) : null);
  if (!money) return "Shopify has not returned a compare-at price for the selected variant.";
  const scope = bar.type === "buy_x_get_y"
    ? "The preview adds the buy group and the get group."
    : bar.type === "alternative_product"
      ? "The preview total follows the configured quantity."
      : "The preview total follows the selected quantity.";
  return `Compare-at price ${formatDecimal(money)} ${money.currencyCode} for one item. ${scope}`;
}

export function previewOffer(document: BundleDocument, barId: string | null, book: JsonPriceBook | null) {
  if (!barId) return { ok: false as const, message: "Select an offer in the preview to see its price." };
  if (!book) return { ok: false as const, message: "Product pricing is not available yet." };
  const priced = priceBookFromJson(book);
  if (!priced.ok) return priced;
  const quote = quoteDocument(document, { bars: [{ barId }] }, priced.book);
  if (!quote.ok) return { ok: false as const, message: quote.errors[0]?.message ?? "This offer cannot be priced." };
  return {
    ok: true as const,
    currency: quote.quote.currencyCode,
    regular: formatDecimal(quote.quote.regularTotal),
    final: formatDecimal(quote.quote.finalTotal),
  };
}

export function previewCountries(shopCountry: string | null) {
  const countries = ["US", "PK", "GB", "CA", "AU", "AE", "SA", "DE", "FR", "IN"];
  const shop = normalizeCountry(shopCountry ?? "");
  if (shop && !countries.includes(shop)) countries.unshift(shop);
  return countries;
}

function selectionFromPreview(product: PreviewProduct): VariantSelection | null {
  const available = product.status === "ACTIVE" ? product.variants.find((variant) => variant.availableForSale) : undefined;
  if (!available) return null;
  return {
    productId: product.id,
    allowedVariantIds: product.variants.map((variant) => variant.id),
    selectedVariantId: available.id,
  };
}

function barBase(id: string, title: string): Omit<BundleBar, "type" | "pricing" | "config"> {
  return {
    id,
    title,
    subtitle: "",
    label: "",
    textTemplate: "",
    selectedByDefault: false,
    images: emptyBarImages(),
    upsells: [],
    gifts: { selection: "single", items: [] },
    freeShipping: { enabled: false, maximumRate: null },
    personalisation: { enabled: false, perUnit: false, fields: [] },
    highlights: [],
    soldOut: { appearance: "hide", restrictSelection: true },
    extensions: null,
  };
}

function catalogItemId(productId: string) {
  const digits = productId.replace(/\D/g, "").slice(-16);
  return `p${digits || "item"}`;
}

function normalizeCountry(value: string) {
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "US";
}

function priceBookFromJson(book: JsonPriceBook): { ok: true; book: PriceBook } | { ok: false; message: string } {
  const variants: PriceBook["variants"] = {};
  for (const [id, point] of Object.entries(book.variants)) {
    const regular = moneyFromJson(point.regular);
    const compareAt = moneyFromJson(point.compareAt);
    if (point.regular && !regular) return { ok: false, message: "A product price could not be read." };
    variants[id] = { regular, compareAt, available: point.available };
  }
  return { ok: true, book: { currencyCode: book.currencyCode, variants } };
}

function moneyFromJson(value: JsonMoney | null): Money | null {
  if (!value || !/^\d+$/.test(value.amountMinor)) return null;
  return { amountMinor: BigInt(value.amountMinor), currencyCode: value.currencyCode, exponent: value.exponent };
}

function eligibleDefaultId(document: BundleDocument) {
  return document.bars.find((bar) => bar.selectedByDefault && barSelectable(bar))?.id ?? null;
}

function nextPreviewBar(state: EditorState, document: BundleDocument) {
  if (state.previewTouched) {
    return state.previewBarId && document.bars.some((bar) => bar.id === state.previewBarId) ? state.previewBarId : null;
  }
  return eligibleDefaultId(document);
}

function withExclusiveDefault(bars: BundleBar[], next: BundleBar) {
  return bars.map((bar) => {
    if (bar.id === next.id) return next;
    if (next.selectedByDefault && bar.selectedByDefault) return { ...bar, selectedByDefault: false };
    return bar;
  });
}

function templateValues(bar: BundleBar, quote: DealQuote | null, titles: Record<string, string>): TemplateValues {
  const productId = primaryProductId(bar);
  const quantity = quote
    ? String(quote.lines.filter((line) => line.role === "merchandise").reduce((sum, line) => sum + line.quantity, 0))
    : String(configuredQuantity(bar));
  return {
    product: titles[productId] ?? "",
    quantity,
    buyQuantity: groupQuantity(bar, quote, "buy"),
    getQuantity: groupQuantity(bar, quote, "get"),
    regularPrice: quote ? moneyLabel(quote.regularTotal) : "",
    compareAtPrice: quote ? compareAtLabel(quote) ?? "" : "",
    finalPrice: quote ? moneyLabel(quote.finalTotal) : "",
    discount: quote ? moneyLabel(quote.appliedDiscountTotal) : "",
    savings: quote ? moneyLabel(customerFacingSavings(quote).amount) : "",
    savedPercentage: quote ? savedPercentageLabel(customerFacingSavings(quote).reference, customerFacingSavings(quote).amount) : "",
    currency: quote?.currencyCode ?? "",
  };
}

function priceSummary(quote: DealQuote): Extract<BarPreview["price"], { ok: true }> {
  const facing = customerFacingSavings(quote);
  return {
    ok: true,
    currency: quote.currencyCode,
    final: formatDecimal(quote.finalTotal),
    regular: formatDecimal(quote.regularTotal),
    compareAt: compareAtLabel(quote),
    savings: formatDecimal(facing.amount),
    savedPercentage: savedPercentageLabel(facing.reference, facing.amount),
  };
}

function selectionFor(bar: BundleBar, choice: PreviewChoice | undefined): BarSelection {
  const selection: BarSelection = { barId: bar.id };
  if (!choice) return selection;
  if (bar.type === "quantity_break") {
    if (bar.config.quantitySelector && choice.quantity != null) selection.quantity = choice.quantity;
    if (choice.variantId && bar.config.product.allowedVariantIds.includes(choice.variantId)) selection.variantId = choice.variantId;
  }
  if (bar.type === "buy_x_get_y" && choice.variantId && bar.config.product.allowedVariantIds.includes(choice.variantId)) {
    selection.variantId = choice.variantId;
    if (!bar.config.getProduct) selection.getVariantId = choice.variantId;
  }
  if (bar.type === "alternative_product" && choice.variantId && bar.config.product.allowedVariantIds.includes(choice.variantId)) {
    selection.variantId = choice.variantId;
  }
  if (bar.type === "mix_and_match") {
    const slots = bar.config.slots.flatMap((slot) => {
      const variantId = choice.rows?.[slot.id]?.variantId;
      if (!variantId) return [];
      return [{ slotId: slot.id, variantId }];
    });
    if (slots.length > 0) selection.slots = slots;
  }
  if (bar.type === "product_bundle") {
    selection.products = bar.config.products.map((product) => {
      const row = choice.rows?.[product.id];
      const item: { productId: string; quantity?: number; variantId?: string } = { productId: product.id };
      if (product.quantitySelector && row?.quantity != null) item.quantity = row.quantity;
      if (row?.variantId && product.product.allowedVariantIds.includes(row.variantId)) item.variantId = row.variantId;
      return item;
    });
  }
  return selection;
}

function bundleProducts(
  bar: BundleBar,
  quote: DealQuote | null,
  choice: PreviewChoice | undefined,
  book: JsonPriceBook | null,
  titles: Record<string, string>,
  catalog: PreviewProduct[],
): PreviewBundleProduct[] {
  if (bar.type !== "product_bundle") return [];
  return bar.config.products.map((product) => {
    const known = catalog.find((item) => item.id === product.product.productId);
    const row = choice?.rows?.[product.id];
    const variantId = row?.variantId && product.product.allowedVariantIds.includes(row.variantId) ? row.variantId : product.product.selectedVariantId;
    const line = quote?.lines.find((item) => item.lineId === `${bar.id}:product:${product.id}`);
    return {
      rowId: product.id,
      role: product.role,
      title: known?.title ?? titles[product.product.productId] ?? "Selected product",
      imageUrl: known?.featuredImageUrl ?? null,
      imageAlt: known?.featuredImageAlt ?? known?.title ?? "Product",
      quantity: line?.quantity ?? row?.quantity ?? product.quantity,
      quantitySelector: product.quantitySelector,
      variantId,
      variants: product.product.allowedVariantIds.map((id) => ({
        id,
        title: known?.variants.find((variant) => variant.id === id)?.title ?? "Variant",
        available: book?.variants[id]?.available === true,
      })),
      final: line ? formatDecimal(line.finalLinePrice) : null,
      compareAt: line?.compareAtLinePrice ? `${formatDecimal(line.compareAtLinePrice)} ${line.compareAtLinePrice.currencyCode}` : null,
      canSwap: false,
    };
  });
}

function mixProducts(
  bar: Extract<BundleBar, { type: "mix_and_match" }>,
  quote: DealQuote | null,
  choice: PreviewChoice | undefined,
  book: JsonPriceBook | null,
  titles: Record<string, string>,
  catalog: PreviewProduct[],
  memberships: VerifiedCollectionMembership[],
  values: TemplateValues,
): PreviewBundleProduct[] {
  return bar.config.slots.map((slot) => {
    const requested = choice?.rows?.[slot.id]?.variantId;
    const variantId = requested && slotAllowsVariant(slot, requested, memberships) ? requested : slot.product.selectedVariantId;
    const productId = productIdForVariant(slot, variantId, memberships);
    const known = catalog.find((item) => item.id === productId);
    const line = quote?.lines.find((item) => item.lineId === `${bar.id}:slot:${slot.id}`);
    const variantIds = variantsForProduct(slot, productId, memberships);
    return {
      rowId: slot.id,
      role: slot.role,
      title: resolveTemplate(slot.title, { ...values, product: known?.title ?? titles[productId] ?? "" }) || known?.title || "Selected product",
      imageUrl: known?.featuredImageUrl ?? null,
      imageAlt: known?.featuredImageAlt ?? known?.title ?? "Product",
      quantity: 1,
      quantitySelector: false,
      variantId,
      variants: variantIds.map((id) => ({
        id,
        title: known?.variants.find((variant) => variant.id === id)?.title ?? "Variant",
        available: book?.variants[id]?.available === true,
      })),
      final: line ? formatDecimal(line.finalLinePrice) : null,
      compareAt: line?.compareAtLinePrice ? `${formatDecimal(line.compareAtLinePrice)} ${line.compareAtLinePrice.currencyCode}` : null,
      canSwap: slot.swapProducts.length > 0 || slot.swapCollectionIds.length > 0,
    };
  });
}

export function membershipsFromPages(pages: CollectionPage[], document: BundleDocument): VerifiedCollectionMembership[] {
  const allowed = new Set(collectCollectionIds(document));
  return pages.flatMap((page) => allowed.has(page.collectionId)
    ? page.products.map((product) => ({
      collectionId: page.collectionId,
      productId: product.id,
      variantIds: product.variants.map((variant) => variant.id),
    }))
    : []);
}

export function collectCollectionIds(document: BundleDocument) {
  const ids = new Set<string>();
  for (const bar of document.bars) {
    if (bar.type !== "mix_and_match") continue;
    for (const slot of bar.config.slots) {
      for (const id of slot.swapCollectionIds) ids.add(id);
    }
  }
  return [...ids];
}

export type SwapChoice = {
  productId: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  source: "original" | "product" | "collection";
  variantId: string;
  variants: Array<{ id: string; title: string; available: boolean; price: string | null }>;
};

export function swapChoices(
  slot: MixSlot,
  catalog: PreviewProduct[],
  pages: CollectionPage[],
  book: JsonPriceBook | null,
  titles: Record<string, string>,
): SwapChoice[] {
  const seen = new Set<string>();
  const choices: SwapChoice[] = [];
  const push = (choice: SwapChoice) => {
    if (seen.has(choice.productId)) return;
    seen.add(choice.productId);
    choices.push(choice);
  };
  push(choiceFromSelection(slot.product, "original", catalog, book, titles));
  for (const product of slot.swapProducts) push(choiceFromSelection(product, "product", catalog, book, titles));
  for (const collectionId of slot.swapCollectionIds) {
    const page = pages.find((item) => item.collectionId === collectionId);
    for (const product of page?.products ?? []) {
      if (seen.has(product.id)) continue;
      push(choiceFromCatalog(product, book));
    }
  }
  return choices;
}

function choiceFromSelection(
  selection: VariantSelection,
  source: "original" | "product",
  catalog: PreviewProduct[],
  book: JsonPriceBook | null,
  titles: Record<string, string>,
): SwapChoice {
  const known = catalog.find((item) => item.id === selection.productId);
  const variants = selection.allowedVariantIds.map((id) => variantChoice(id, known, book));
  const selected = variants.find((variant) => variant.id === selection.selectedVariantId && variant.available) ?? variants.find((variant) => variant.available) ?? variants[0];
  return {
    productId: selection.productId,
    title: known?.title ?? titles[selection.productId] ?? "Selected product",
    imageUrl: known?.featuredImageUrl ?? null,
    imageAlt: known?.featuredImageAlt ?? known?.title ?? "Product",
    source,
    variantId: selected?.id ?? selection.selectedVariantId,
    variants,
  };
}

function choiceFromCatalog(product: PreviewProduct, book: JsonPriceBook | null): SwapChoice {
  const variants = product.variants.map((variant) => variantChoice(variant.id, product, book));
  const selected = variants.find((variant) => variant.available) ?? variants[0];
  return {
    productId: product.id,
    title: product.title,
    imageUrl: product.featuredImageUrl,
    imageAlt: product.featuredImageAlt ?? product.title,
    source: "collection",
    variantId: selected?.id ?? "",
    variants,
  };
}

function variantChoice(id: string, known: PreviewProduct | undefined, book: JsonPriceBook | null) {
  const point = book?.variants[id];
  const catalogVariant = known?.variants.find((variant) => variant.id === id);
  const available = point ? point.available : catalogVariant?.availableForSale === true;
  const regular = point?.regular ? moneyFromJson(point.regular) : null;
  return {
    id,
    title: catalogVariant?.title ?? "Variant",
    available,
    price: regular ? `${formatDecimal(regular)} ${regular.currencyCode}` : catalogVariant?.regularLabel ?? null,
  };
}

function slotAllowsVariant(slot: MixSlot, variantId: string, memberships: VerifiedCollectionMembership[]) {
  return slot.product.allowedVariantIds.includes(variantId)
    || slot.swapProducts.some((product) => product.allowedVariantIds.includes(variantId))
    || memberships.some((membership) => slot.swapCollectionIds.includes(membership.collectionId) && membership.variantIds.includes(variantId));
}

function productIdForVariant(slot: MixSlot, variantId: string, memberships: VerifiedCollectionMembership[]) {
  if (slot.product.allowedVariantIds.includes(variantId)) return slot.product.productId;
  const swap = slot.swapProducts.find((product) => product.allowedVariantIds.includes(variantId));
  if (swap) return swap.productId;
  return memberships.find((membership) => slot.swapCollectionIds.includes(membership.collectionId) && membership.variantIds.includes(variantId))?.productId
    ?? slot.product.productId;
}

function variantsForProduct(slot: MixSlot, productId: string, memberships: VerifiedCollectionMembership[]) {
  if (slot.product.productId === productId) return slot.product.allowedVariantIds;
  const swap = slot.swapProducts.find((product) => product.productId === productId);
  if (swap) return swap.allowedVariantIds;
  const ids = memberships
    .filter((membership) => slot.swapCollectionIds.includes(membership.collectionId) && membership.productId === productId)
    .flatMap((membership) => membership.variantIds);
  return [...new Set(ids)];
}

function sanitizePreviewRows(
  rows: EditorState["previewRows"],
  document: BundleDocument,
  memberships: VerifiedCollectionMembership[],
) {
  const next: EditorState["previewRows"] = {};
  for (const [key, value] of Object.entries(rows)) {
    const separator = key.indexOf(":");
    if (separator < 0) continue;
    const bar = document.bars.find((item) => item.id === key.slice(0, separator));
    const rowId = key.slice(separator + 1);
    if (bar?.type === "product_bundle") {
      const row = bar.config.products.find((product) => product.id === rowId);
      if (!row) continue;
      const quantity = row.quantitySelector ? value.quantity : undefined;
      const variantId = value.variantId && row.product.allowedVariantIds.includes(value.variantId) ? value.variantId : undefined;
      if (quantity == null && variantId == null) continue;
      next[key] = { quantity, variantId };
    }
    if (bar?.type === "mix_and_match") {
      const slot = bar.config.slots.find((item) => item.id === rowId);
      if (!slot || !value.variantId || !slotAllowsVariant(slot, value.variantId, memberships)) continue;
      next[key] = { variantId: value.variantId };
    }
  }
  return next;
}

function dedupeProducts(products: PreviewProduct[]) {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

function groupQuantity(bar: BundleBar, quote: DealQuote | null, group: "buy" | "get") {
  if (bar.type !== "buy_x_get_y") return "";
  const line = quote?.lines.find((item) => item.lineId.endsWith(`:${group}`));
  if (line) return String(line.quantity);
  return String(group === "buy" ? bar.config.buyQuantity : bar.config.getQuantity);
}

function sanitizeAlternativePreview(
  variants: Record<string, string>,
  document: BundleDocument,
  book: JsonPriceBook | null,
) {
  const next = { ...variants };
  for (const [barId, variantId] of Object.entries(variants)) {
    const bar = document.bars.find((item) => item.id === barId);
    if (bar?.type !== "alternative_product") continue;
    const point = book?.variants[variantId];
    if (!bar.config.product.allowedVariantIds.includes(variantId) || (point != null && !point.available)) delete next[barId];
  }
  return next;
}

function previewVariants(bar: BundleBar, book: JsonPriceBook | null, catalog: PreviewProduct[]) {
  if (bar.type !== "quantity_break" && bar.type !== "buy_x_get_y" && bar.type !== "alternative_product") return [];
  const product = catalog.find((item) => item.id === bar.config.product.productId);
  return bar.config.product.allowedVariantIds.map((id) => ({
    id,
    title: product?.variants.find((variant) => variant.id === id)?.title ?? "Variant",
    available: book?.variants[id]?.available === true,
  }));
}

function compareAtLabel(quote: DealQuote) {
  if (quote.compareAt.coverage !== "complete") return null;
  const lines = quote.lines.filter((line) => line.compareAtLinePrice);
  if (lines.length === 0 || lines.some((line) => !line.compareAtLinePrice)) return null;
  const total = lines.reduce((sum, line) => sum + (line.compareAtLinePrice?.amountMinor ?? 0n), 0n);
  return `${formatDecimal({ ...quote.finalTotal, amountMinor: total })} ${quote.currencyCode}`;
}

function primaryProductId(bar: BundleBar) {
  if (bar.type === "product_bundle") return bar.config.products.find((product) => product.role === "default")?.product.productId ?? "";
  if (bar.type === "mix_and_match") return bar.config.slots.find((slot) => slot.role === "default")?.product.productId ?? "";
  return bar.config.product.productId;
}

function configuredQuantity(bar: BundleBar) {
  if (bar.type === "quantity_break" || bar.type === "alternative_product") return bar.config.quantity;
  if (bar.type === "buy_x_get_y") return bar.config.buyQuantity + bar.config.getQuantity;
  if (bar.type === "product_bundle") return bar.config.products.reduce((sum, product) => sum + product.quantity, 0);
  return bar.config.slots.length;
}
