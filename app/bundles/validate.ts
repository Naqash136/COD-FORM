import { currencyExponent, normalizeCurrencyCode } from "./currencies";
import {
  BAR_IMAGE_RADIUS_MAX,
  BAR_IMAGE_RADIUS_MIN,
  BAR_IMAGE_SIZE_MAX,
  BAR_IMAGE_SIZE_MIN,
  DEFAULT_BAR_IMAGE_RADIUS,
  DEFAULT_BAR_IMAGE_SIZE,
  MAX_COMPOSITION_ITEMS,
  isPersistentImageUrl,
} from "./images";
import {
  BAR_TYPES,
  SCHEMA_VERSION,
  TEXT_VARIABLES,
  type BundleBar,
  type BundleDocument,
  type BundlePricing,
  type CatalogProduct,
  type GetPricing,
  type GiftConfig,
  type GroupPricing,
  type Highlight,
  type ImageRef,
  type JsonValue,
  type MixSlot,
  type PersonalisationField,
  type ProductBundleProduct,
  type StoredMoney,
  type Upsell,
  type ValidationIssue,
  type VariantSelection,
} from "./schema";

const LIMITS = {
  name: 120,
  title: 120,
  subtitle: 180,
  label: 80,
  template: 300,
  highlight: 80,
  alt: 120,
  choice: 40,
  bars: 20,
  products: 30,
  variants: 100,
  swaps: 20,
  upsells: 8,
  gifts: 8,
  highlights: 8,
  fields: 8,
  choices: 12,
  collections: 20,
  documentChars: 100_000,
  quantity: 999,
} as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;
const FILE_GID = /^gid:\/\/shopify\/(?:MediaImage|GenericFile|Image)\/\d+$/;
const AMOUNT_MINOR = /^(0|[1-9]\d{0,14})$/;
const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const BAR_TYPE_SET = new Set<string>(BAR_TYPES);
const TEXT_VARIABLE_SET = new Set<string>(TEXT_VARIABLES);
const SOLD_OUT = new Set(["hide", "show_unavailable", "show_selectable"]);
const INPUT_TYPES = new Set(["text", "number", "choice"]);

export type ValidationResult =
  | { ok: true; document: BundleDocument }
  | { ok: false; errors: ValidationIssue[] };

type ErrorList = ValidationIssue[];
type RecordValue = Record<string, unknown>;

export function validateDocument(input: unknown, mode: "draft" | "publish"): ValidationResult {
  const errors: ErrorList = [];
  const record = readObject(input, "document", errors);
  if (!record) return { ok: false, errors };
  rejectSubscriptions(input, "document", errors);
  rejectUnknown(
    record,
    ["schemaVersion", "name", "products", "settings", "style", "bars", "modal", "targeting", "extensions"],
    "document",
    errors,
  );
  if (record.schemaVersion !== SCHEMA_VERSION) {
    errors.push(issue("document.schemaVersion", "unsupported_version", "Unsupported configuration version."));
  }

  const name = readText(record.name, "document.name", 1, LIMITS.name, errors);
  const products = readCatalog(record.products, "document.products", errors);
  const settings = readExtensionSection(record.settings, "document.settings", errors);
  const style = readExtensionSection(record.style, "document.style", errors);
  const modal = readExtensionSection(record.modal, "document.modal", errors);
  const targeting = readTargeting(record.targeting, "document.targeting", errors);
  const extensions = readExtensions(record.extensions, "document.extensions", errors);
  const barsInput = readList(record.bars, "document.bars", mode === "publish" ? 1 : 0, LIMITS.bars, errors);

  const bars: BundleBar[] = [];
  const ids = new Set<string>();
  barsInput?.forEach((bar, index) => {
    const parsed = readBar(bar, `document.bars.${index}`, ids, errors);
    if (parsed) bars.push(parsed);
  });
  if (bars.filter((bar) => bar.selectedByDefault).length > 1) {
    errors.push(issue("document.bars", "multiple_defaults", "Only one bar can be selected by default."));
  }

  if (errors.length > 0 || !name || !products || !settings || !style || !modal || !targeting || !extensions) {
    return { ok: false, errors };
  }
  const document: BundleDocument = {
    schemaVersion: SCHEMA_VERSION,
    name,
    products,
    settings,
    style,
    bars,
    modal,
    targeting,
    extensions: extensions.value,
  };
  if (JSON.stringify(document).length > LIMITS.documentChars) {
    return { ok: false, errors: [issue("document", "too_large", "Configuration is too large.")] };
  }
  return { ok: true, document };
}

function readBar(input: unknown, path: string, ids: Set<string>, errors: ErrorList): BundleBar | null {
  const record = readObject(input, path, errors);
  if (!record) return null;
  const type = typeof record.type === "string" && BAR_TYPE_SET.has(record.type) ? record.type : null;
  if (!type) errors.push(issue(`${path}.type`, "invalid_type", "Unknown bar type."));
  const allowed = [
    "id", "type", "title", "subtitle", "label", "textTemplate", "selectedByDefault",
    "images", "upsells", "gifts", "freeShipping", "personalisation", "highlights",
    "soldOut", "extensions", "config",
  ];
  if (type !== "product_bundle") allowed.push("pricing");
  rejectUnknown(record, allowed, path, errors);

  const id = readId(record.id, `${path}.id`, errors);
  if (id && ids.has(id)) errors.push(issue(`${path}.id`, "duplicate_id", "Bar id must be unique."));
  if (id) ids.add(id);
  const title = readText(record.title, `${path}.title`, 1, LIMITS.title, errors) ?? "";
  const subtitle = readText(record.subtitle, `${path}.subtitle`, 0, LIMITS.subtitle, errors) ?? "";
  const label = readText(record.label, `${path}.label`, 0, LIMITS.label, errors) ?? "";
  const textTemplate = readTemplate(record.textTemplate, `${path}.textTemplate`, errors) ?? "";
  const selectedByDefault = readBoolean(record.selectedByDefault, `${path}.selectedByDefault`, errors) ?? false;
  const images = readImages(record.images, `${path}.images`, errors);
  const upsells = readUpsells(record.upsells, `${path}.upsells`, errors);
  const gifts = readGifts(record.gifts, `${path}.gifts`, errors);
  const freeShipping = readShipping(record.freeShipping, `${path}.freeShipping`, errors);
  const personalisation = readPersonalisation(record.personalisation, `${path}.personalisation`, errors);
  const highlights = readHighlights(record.highlights, `${path}.highlights`, errors);
  const soldOut = readSoldOut(record.soldOut, `${path}.soldOut`, errors);
  const extensions = readExtensions(record.extensions, `${path}.extensions`, errors)?.value ?? null;
  if (!type || !id || !images || !gifts || !freeShipping || !personalisation || !soldOut) return null;
  const base = {
    id,
    title,
    subtitle,
    label,
    textTemplate,
    selectedByDefault,
    images,
    upsells,
    gifts,
    freeShipping,
    personalisation,
    highlights,
    soldOut,
    extensions,
  };
  const config = readObject(record.config, `${path}.config`, errors);
  if (!config) return null;

  if (type === "quantity_break") {
    const pricing = readGroupPricing(record.pricing, `${path}.pricing`, errors);
    const product = readVariant(config.product, `${path}.config.product`, errors);
    const quantity = readQuantity(config.quantity, `${path}.config.quantity`, errors);
    const quantitySelector = readBoolean(config.quantitySelector, `${path}.config.quantitySelector`, errors);
    rejectUnknown(config, ["product", "quantity", "quantitySelector"], `${path}.config`, errors);
    if (!pricing || !product || quantity == null || quantitySelector == null) return null;
    return { ...base, type, pricing, config: { product, quantity, quantitySelector } };
  }
  if (type === "buy_x_get_y") {
    const pricing = readGroupPricing(record.pricing, `${path}.pricing`, errors);
    const product = readVariant(config.product, `${path}.config.product`, errors);
    const buyQuantity = readQuantity(config.buyQuantity, `${path}.config.buyQuantity`, errors);
    const getQuantity = readQuantity(config.getQuantity, `${path}.config.getQuantity`, errors);
    const getPricing = readGetPricing(config.getPricing, `${path}.config.getPricing`, errors);
    const getProduct = config.getProduct == null ? null : readVariant(config.getProduct, `${path}.config.getProduct`, errors);
    rejectUnknown(config, ["product", "buyQuantity", "getQuantity", "getPricing", "getProduct"], `${path}.config`, errors);
    if (!pricing || !product || buyQuantity == null || getQuantity == null || !getPricing || (config.getProduct != null && !getProduct)) {
      return null;
    }
    return { ...base, type, pricing, config: { product, buyQuantity, getQuantity, getPricing, getProduct } };
  }
  if (type === "product_bundle") {
    const layout = config.layout === "horizontal" || config.layout === "vertical" ? config.layout : null;
    if (!layout) errors.push(issue(`${path}.config.layout`, "invalid_type", "Layout must be horizontal or vertical."));
    const hideIndividualPrice = readBoolean(config.hideIndividualPrice, `${path}.config.hideIndividualPrice`, errors);
    const showOnlyWhenSelected = readBoolean(config.showOnlyWhenSelected, `${path}.config.showOnlyWhenSelected`, errors);
    const products = readBundleProducts(config.products, `${path}.config.products`, errors);
    rejectUnknown(config, ["layout", "hideIndividualPrice", "showOnlyWhenSelected", "products"], `${path}.config`, errors);
    if (!layout || hideIndividualPrice == null || showOnlyWhenSelected == null || !products) return null;
    return { ...base, type, config: { layout, hideIndividualPrice, showOnlyWhenSelected, products } };
  }
  if (type === "mix_and_match") {
    const pricing = readBundlePricing(record.pricing, `${path}.pricing`, errors);
    const showPrices = readBoolean(config.showPrices, `${path}.config.showPrices`, errors);
    const showOnlyWhenSelected = readBoolean(config.showOnlyWhenSelected, `${path}.config.showOnlyWhenSelected`, errors);
    const changeButtonLabel = readText(config.changeButtonLabel, `${path}.config.changeButtonLabel`, 0, LIMITS.label, errors);
    const selectionModal = readObject(config.selectionModal, `${path}.config.selectionModal`, errors);
    const modalTitle = selectionModal
      ? readText(selectionModal.title, `${path}.config.selectionModal.title`, 0, LIMITS.title, errors)
      : null;
    if (selectionModal) rejectUnknown(selectionModal, ["title"], `${path}.config.selectionModal`, errors);
    const slots = readMixSlots(config.slots, `${path}.config.slots`, errors);
    rejectUnknown(config, ["showPrices", "showOnlyWhenSelected", "changeButtonLabel", "selectionModal", "slots"], `${path}.config`, errors);
    if (!pricing || showPrices == null || showOnlyWhenSelected == null || changeButtonLabel == null || modalTitle == null || !slots) {
      return null;
    }
    return {
      ...base,
      type,
      pricing,
      config: { showPrices, showOnlyWhenSelected, changeButtonLabel, selectionModal: { title: modalTitle }, slots },
    };
  }
  const pricing = readGroupPricing(record.pricing, `${path}.pricing`, errors);
  const product = readVariant(config.product, `${path}.config.product`, errors);
  const quantity = readQuantity(config.quantity, `${path}.config.quantity`, errors);
  rejectUnknown(config, ["product", "quantity"], `${path}.config`, errors);
  if (!pricing || !product || quantity == null) return null;
  return { ...base, type: "alternative_product", pricing, config: { product, quantity } };
}

function readBundleProducts(input: unknown, path: string, errors: ErrorList) {
  const list = readList(input, path, 1, LIMITS.products, errors);
  if (!list) return null;
  const products: ProductBundleProduct[] = [];
  list.forEach((item, index) => {
    const record = readObject(item, `${path}.${index}`, errors);
    if (!record) return;
    rejectUnknown(record, ["id", "role", "product", "quantity", "quantitySelector", "pricing"], `${path}.${index}`, errors);
    const id = readId(record.id, `${path}.${index}.id`, errors);
    const role = record.role === "default" || record.role === "additional" ? record.role : null;
    if (!role) errors.push(issue(`${path}.${index}.role`, "invalid_type", "Product role must be default or additional."));
    const product = readVariant(record.product, `${path}.${index}.product`, errors);
    const quantity = readQuantity(record.quantity, `${path}.${index}.quantity`, errors);
    const quantitySelector = readBoolean(record.quantitySelector, `${path}.${index}.quantitySelector`, errors);
    const pricing = readGroupPricing(record.pricing, `${path}.${index}.pricing`, errors);
    if (id && role && product && quantity != null && quantitySelector != null && pricing) {
      products.push({ id, role, product, quantity, quantitySelector, pricing });
    }
  });
  if (products.length !== list.length) return null;
  if (products.filter((product) => product.role === "default").length !== 1) {
    errors.push(issue(path, "default_product", "A product bundle needs exactly one default product."));
    return null;
  }
  return products;
}

function readMixSlots(input: unknown, path: string, errors: ErrorList) {
  const list = readList(input, path, 1, LIMITS.products, errors);
  if (!list) return null;
  const slots: MixSlot[] = [];
  list.forEach((item, index) => {
    const record = readObject(item, `${path}.${index}`, errors);
    if (!record) return;
    rejectUnknown(record, ["id", "role", "title", "product", "swapProducts", "swapCollectionIds"], `${path}.${index}`, errors);
    const id = readId(record.id, `${path}.${index}.id`, errors);
    const role = record.role === "default" || record.role === "additional" ? record.role : null;
    if (!role) errors.push(issue(`${path}.${index}.role`, "invalid_type", "Slot role must be default or additional."));
    const title = readText(record.title, `${path}.${index}.title`, 0, LIMITS.title, errors);
    const product = readVariant(record.product, `${path}.${index}.product`, errors);
    const swapProducts = readVariantList(record.swapProducts, `${path}.${index}.swapProducts`, 0, LIMITS.swaps, errors);
    const swapCollectionIds = readGidList(record.swapCollectionIds, `${path}.${index}.swapCollectionIds`, COLLECTION_GID, 0, LIMITS.collections, errors);
    if (id && role && title != null && product && swapProducts && swapCollectionIds) {
      slots.push({ id, role, title, product, swapProducts, swapCollectionIds });
    }
  });
  if (slots.length !== list.length) return null;
  if (slots.filter((slot) => slot.role === "default").length !== 1) {
    errors.push(issue(path, "default_product", "Mix and match needs exactly one default slot."));
    return null;
  }
  return slots;
}

function readGroupPricing(input: unknown, path: string, errors: ErrorList): GroupPricing | null {
  const record = readObject(input, path, errors);
  if (!record) return null;
  if (record.mode === "full_price") {
    rejectUnknown(record, ["mode"], path, errors);
    return { mode: "full_price" };
  }
  if (record.mode === "percentage_off") {
    return readScopedPercentage(record, path, "per_line", errors) as GroupPricing | null;
  }
  if (record.mode === "amount_off") {
    return readScopedMoney(record, path, "amount_off", "per_item", errors) as GroupPricing | null;
  }
  if (record.mode === "fixed_price") {
    return readScopedMoney(record, path, "fixed_price", "per_group", errors) as GroupPricing | null;
  }
  errors.push(issue(`${path}.mode`, "invalid_mode", "Unknown pricing mode."));
  return null;
}

function readGetPricing(input: unknown, path: string, errors: ErrorList): GetPricing | null {
  const pricing = readGroupPricing(input, path, errors);
  if (pricing?.mode === "full_price") {
    errors.push(issue(`${path}.mode`, "invalid_mode", "Get pricing cannot be full price."));
    return null;
  }
  return pricing;
}

function readBundlePricing(input: unknown, path: string, errors: ErrorList): BundlePricing | null {
  const record = readObject(input, path, errors);
  if (!record) return null;
  if (record.mode === "full_price") {
    rejectUnknown(record, ["mode"], path, errors);
    return { mode: "full_price" };
  }
  if (record.mode === "percentage_off") return readScopedPercentage(record, path, "per_deal", errors);
  if (record.mode === "amount_off") return readScopedMoney(record, path, "amount_off", "per_deal", errors);
  if (record.mode === "fixed_price") return readScopedMoney(record, path, "fixed_price", "per_deal", errors);
  errors.push(issue(`${path}.mode`, "invalid_mode", "Unknown pricing mode."));
  return null;
}

function readScopedPercentage<Scope extends "per_line" | "per_deal">(
  record: RecordValue,
  path: string,
  expected: Scope,
  errors: ErrorList,
): { mode: "percentage_off"; basisPoints: number; scope: Scope } | null {
  rejectUnknown(record, ["mode", "basisPoints", "scope"], path, errors);
  const basisPoints = record.basisPoints;
  if (typeof basisPoints !== "number" || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    errors.push(issue(`${path}.basisPoints`, "invalid_percentage", "Percentage must be from 0 to 100."));
    return null;
  }
  if (record.scope !== expected) {
    errors.push(issue(`${path}.scope`, "invalid_scope", `Percentage scope must be ${expected}.`));
    return null;
  }
  return { mode: "percentage_off" as const, basisPoints, scope: expected };
}

function readScopedMoney<Mode extends "amount_off" | "fixed_price", Scope extends "per_item" | "per_group" | "per_deal">(
  record: RecordValue,
  path: string,
  mode: Mode,
  expected: Scope,
  errors: ErrorList,
): { mode: Mode; amount: StoredMoney; scope: Scope } | null {
  rejectUnknown(record, ["mode", "amount", "scope"], path, errors);
  const amount = readStoredMoney(record.amount, `${path}.amount`, errors);
  if (record.scope !== expected) {
    errors.push(issue(`${path}.scope`, "invalid_scope", `${mode} scope must be ${expected}.`));
    return null;
  }
  if (!amount) return null;
  return { mode, amount, scope: expected };
}

function readCatalog(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["items"], path, errors);
  const list = readList(record.items, `${path}.items`, 0, LIMITS.products, errors);
  if (!list) return null;
  const items: CatalogProduct[] = [];
  list.forEach((item, index) => {
    const entry = readObject(item, `${path}.items.${index}`, errors);
    if (!entry) return;
    rejectUnknown(entry, ["id", "product"], `${path}.items.${index}`, errors);
    const id = readId(entry.id, `${path}.items.${index}.id`, errors);
    const product = readVariant(entry.product, `${path}.items.${index}.product`, errors);
    if (id && product) items.push({ id, product });
  });
  return items.length === list.length ? { items } : null;
}

function readTargeting(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["productIds", "collectionIds"], path, errors);
  const productIds = readGidList(record.productIds, `${path}.productIds`, PRODUCT_GID, 0, LIMITS.products, errors);
  const collectionIds = readGidList(record.collectionIds, `${path}.collectionIds`, COLLECTION_GID, 0, LIMITS.collections, errors);
  if (!productIds || !collectionIds) return null;
  return { productIds, collectionIds };
}

function readExtensionSection(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["extensions"], path, errors);
  const extensions = readExtensions(record.extensions, `${path}.extensions`, errors);
  return extensions ? { extensions: extensions.value } : null;
}

function readUpsells(input: unknown, path: string, errors: ErrorList): Upsell[] {
  const list = readList(input, path, 0, LIMITS.upsells, errors) ?? [];
  const upsells: Upsell[] = [];
  list.forEach((item, index) => {
    const record = readObject(item, `${path}.${index}`, errors);
    if (!record) return;
    rejectUnknown(record, ["id", "kind", "product", "quantity", "pricing"], `${path}.${index}`, errors);
    const id = readId(record.id, `${path}.${index}.id`, errors);
    const kind = record.kind === "manual" || record.kind === "complementary" ? record.kind : null;
    if (!kind) errors.push(issue(`${path}.${index}.kind`, "invalid_type", "Upsell kind must be manual or complementary."));
    const product = readVariant(record.product, `${path}.${index}.product`, errors);
    const quantity = readQuantity(record.quantity, `${path}.${index}.quantity`, errors);
    const pricing = readGroupPricing(record.pricing, `${path}.${index}.pricing`, errors);
    if (id && kind && product && quantity != null && pricing) upsells.push({ id, kind, product, quantity, pricing });
  });
  return upsells;
}

function readGifts(input: unknown, path: string, errors: ErrorList): GiftConfig | null {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["selection", "items"], path, errors);
  const selection = record.selection === "single" || record.selection === "multiple" ? record.selection : null;
  if (!selection) errors.push(issue(`${path}.selection`, "invalid_type", "Gift selection must be single or multiple."));
  const max = selection === "single" ? 1 : LIMITS.gifts;
  const list = readList(record.items, `${path}.items`, 0, max, errors);
  if (!selection || !list) return null;
  const items = list.flatMap((item, index) => {
    const gift = readObject(item, `${path}.items.${index}`, errors);
    if (!gift) return [];
    rejectUnknown(gift, ["id", "product", "quantity"], `${path}.items.${index}`, errors);
    const id = readId(gift.id, `${path}.items.${index}.id`, errors);
    const product = readVariant(gift.product, `${path}.items.${index}.product`, errors);
    const quantity = readQuantity(gift.quantity, `${path}.items.${index}.quantity`, errors);
    return id && product && quantity != null ? [{ id, product, quantity }] : [];
  });
  if (items.length !== list.length) return null;
  return { selection, items };
}

function readShipping(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["enabled", "maximumRate"], path, errors);
  const enabled = readBoolean(record.enabled, `${path}.enabled`, errors);
  const maximumRate = record.maximumRate == null ? null : readStoredMoney(record.maximumRate, `${path}.maximumRate`, errors);
  if (enabled == null || (record.maximumRate != null && !maximumRate)) return null;
  return { enabled, maximumRate };
}

function readPersonalisation(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["enabled", "perUnit", "fields"], path, errors);
  const enabled = readBoolean(record.enabled, `${path}.enabled`, errors);
  const perUnit = readBoolean(record.perUnit, `${path}.perUnit`, errors);
  const fieldsInput = readList(record.fields, `${path}.fields`, 0, LIMITS.fields, errors) ?? [];
  const fields: PersonalisationField[] = [];
  fieldsInput.forEach((item, index) => {
    const field = readObject(item, `${path}.fields.${index}`, errors);
    if (!field) return;
    rejectUnknown(field, ["id", "label", "inputType", "required", "choices"], `${path}.fields.${index}`, errors);
    const id = readId(field.id, `${path}.fields.${index}.id`, errors);
    const label = readText(field.label, `${path}.fields.${index}.label`, 1, LIMITS.title, errors);
    const required = readBoolean(field.required, `${path}.fields.${index}.required`, errors);
    const inputType = typeof field.inputType === "string" && INPUT_TYPES.has(field.inputType) ? field.inputType : null;
    if (!inputType) errors.push(issue(`${path}.fields.${index}.inputType`, "invalid_type", "Unknown field type."));
    const choices = readChoices(field.choices, `${path}.fields.${index}.choices`, inputType === "choice", errors);
    if (id && label && required != null && inputType && choices) {
      fields.push({ id, label, inputType: inputType as PersonalisationField["inputType"], required, choices });
    }
  });
  if (enabled == null || perUnit == null) return null;
  return { enabled, perUnit, fields };
}

function readHighlights(input: unknown, path: string, errors: ErrorList): Highlight[] {
  const list = readList(input, path, 0, LIMITS.highlights, errors) ?? [];
  const highlights: Highlight[] = [];
  list.forEach((item, index) => {
    const record = readObject(item, `${path}.${index}`, errors);
    if (!record) return;
    rejectUnknown(record, ["id", "text", "icon"], `${path}.${index}`, errors);
    const id = readId(record.id, `${path}.${index}.id`, errors);
    const text = readText(record.text, `${path}.${index}.text`, 1, LIMITS.highlight, errors);
    const icon = readImage(record.icon, `${path}.${index}.icon`, errors);
    if (id && text && (record.icon == null || icon)) highlights.push({ id, text, icon });
  });
  return highlights;
}

function readSoldOut(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["appearance", "restrictSelection"], path, errors);
  const appearance = typeof record.appearance === "string" && SOLD_OUT.has(record.appearance) ? record.appearance : null;
  const restrictSelection = readBoolean(record.restrictSelection, `${path}.restrictSelection`, errors);
  if (!appearance) errors.push(issue(`${path}.appearance`, "invalid_type", "Unknown sold-out appearance."));
  if (!appearance || restrictSelection == null) return null;
  return { appearance: appearance as "hide" | "show_unavailable" | "show_selectable", restrictSelection };
}

function readImages(input: unknown, path: string, errors: ErrorList) {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["customBarImage", "featuredImage", "barImageSize", "barImageRadius"], path, errors);
  const barImageSize = readImageMeasure(record.barImageSize, `${path}.barImageSize`, BAR_IMAGE_SIZE_MIN, BAR_IMAGE_SIZE_MAX, DEFAULT_BAR_IMAGE_SIZE, errors);
  const barImageRadius = readImageMeasure(record.barImageRadius, `${path}.barImageRadius`, BAR_IMAGE_RADIUS_MIN, BAR_IMAGE_RADIUS_MAX, DEFAULT_BAR_IMAGE_RADIUS, errors);
  if (barImageSize == null || barImageRadius == null) return null;
  return {
    customBarImage: readImage(record.customBarImage, `${path}.customBarImage`, errors),
    featuredImage: readImage(record.featuredImage, `${path}.featuredImage`, errors),
    barImageSize,
    barImageRadius,
  };
}

function readImageMeasure(input: unknown, path: string, min: number, max: number, fallback: number, errors: ErrorList) {
  if (input == null) return fallback;
  if (typeof input !== "number" || !Number.isInteger(input) || input < min || input > max) {
    errors.push(issue(path, "invalid_amount", `Expected a whole number from ${min} to ${max}.`));
    return null;
  }
  return input;
}

function readImage(input: unknown, path: string, errors: ErrorList): ImageRef | null {
  if (input == null) return null;
  const record = readObject(input, path, errors);
  if (!record) return null;
  const alt = readNullableText(record.alt, `${path}.alt`, LIMITS.alt, errors);
  if (record.source === "product") {
    rejectUnknown(record, ["source", "productId", "alt"], path, errors);
    if (typeof record.productId !== "string" || !PRODUCT_GID.test(record.productId)) {
      errors.push(issue(`${path}.productId`, "invalid_gid", "Expected a product id."));
      return null;
    }
    return { source: "product", productId: record.productId, alt };
  }
  if (record.source === "file") {
    rejectUnknown(record, ["source", "fileId", "alt"], path, errors);
    if (typeof record.fileId !== "string" || !FILE_GID.test(record.fileId)) {
      errors.push(issue(`${path}.fileId`, "invalid_gid", "Expected a Shopify file id."));
      return null;
    }
    return { source: "file", fileId: record.fileId, alt };
  }
  if (record.source === "url") {
    rejectUnknown(record, ["source", "url", "alt"], path, errors);
    if (typeof record.url !== "string" || !isHttpsUrl(record.url)) {
      errors.push(issue(`${path}.url`, "invalid_url", "Image URL must be https."));
      return null;
    }
    return { source: "url", url: record.url, alt };
  }
  if (record.source === "catalog") {
    rejectUnknown(record, ["source", "productId", "url", "alt"], path, errors);
    if (typeof record.productId !== "string" || !PRODUCT_GID.test(record.productId)) {
      errors.push(issue(`${path}.productId`, "invalid_gid", "Expected a product id."));
      return null;
    }
    if (typeof record.url !== "string" || !isPersistentImageUrl(record.url)) {
      errors.push(issue(`${path}.url`, "invalid_url", "Product image URL must be a persistent image reference."));
      return null;
    }
    return { source: "catalog", productId: record.productId, url: record.url, alt };
  }
  if (record.source === "composition") {
    rejectUnknown(record, ["source", "alt", "items"], path, errors);
    const list = readList(record.items, `${path}.items`, 1, MAX_COMPOSITION_ITEMS, errors);
    if (!list) return null;
    const items = list.flatMap((item, index) => {
      const entry = readObject(item, `${path}.items.${index}`, errors);
      if (!entry) return [];
      rejectUnknown(entry, ["productId", "url", "alt"], `${path}.items.${index}`, errors);
      const itemAlt = readNullableText(entry.alt, `${path}.items.${index}.alt`, LIMITS.alt, errors);
      if (typeof entry.productId !== "string" || !PRODUCT_GID.test(entry.productId)) {
        errors.push(issue(`${path}.items.${index}.productId`, "invalid_gid", "Expected a product id."));
        return [];
      }
      if (typeof entry.url !== "string" || !isPersistentImageUrl(entry.url)) {
        errors.push(issue(`${path}.items.${index}.url`, "invalid_url", "Product image URL must be a persistent image reference."));
        return [];
      }
      return [{ productId: entry.productId, url: entry.url, alt: itemAlt }];
    });
    if (items.length !== list.length) return null;
    return { source: "composition", alt, items };
  }
  errors.push(issue(`${path}.source`, "invalid_type", "Unknown image source."));
  return null;
}

function readVariant(input: unknown, path: string, errors: ErrorList): VariantSelection | null {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["productId", "allowedVariantIds", "selectedVariantId"], path, errors);
  if (typeof record.productId !== "string" || !PRODUCT_GID.test(record.productId)) {
    errors.push(issue(`${path}.productId`, "invalid_gid", "Expected a product id."));
    return null;
  }
  const allowedVariantIds = readGidList(record.allowedVariantIds, `${path}.allowedVariantIds`, VARIANT_GID, 1, LIMITS.variants, errors);
  if (!allowedVariantIds) return null;
  if (typeof record.selectedVariantId !== "string" || !allowedVariantIds.includes(record.selectedVariantId)) {
    errors.push(issue(`${path}.selectedVariantId`, "invalid_variant", "Selected variant must be one of the allowed variants."));
    return null;
  }
  return { productId: record.productId, allowedVariantIds, selectedVariantId: record.selectedVariantId };
}

function readVariantList(input: unknown, path: string, min: number, max: number, errors: ErrorList) {
  const list = readList(input, path, min, max, errors);
  if (!list) return null;
  const variants = list.map((item, index) => readVariant(item, `${path}.${index}`, errors));
  return variants.every((variant) => variant != null) ? variants.filter((variant) => variant != null) : null;
}

function readStoredMoney(input: unknown, path: string, errors: ErrorList): StoredMoney | null {
  const record = readObject(input, path, errors);
  if (!record) return null;
  rejectUnknown(record, ["amountMinor", "currencyCode"], path, errors);
  if (typeof record.amountMinor !== "string" || !AMOUNT_MINOR.test(record.amountMinor)) {
    errors.push(issue(`${path}.amountMinor`, "invalid_amount", "Amount must be a non-negative minor-unit integer."));
    return null;
  }
  if (typeof record.currencyCode !== "string" || currencyExponent(normalizeCurrencyCode(record.currencyCode)) == null) {
    errors.push(issue(`${path}.currencyCode`, "unknown_currency", "Currency is not a Shopify currency."));
    return null;
  }
  return { amountMinor: record.amountMinor, currencyCode: normalizeCurrencyCode(record.currencyCode) };
}

function readGidList(input: unknown, path: string, pattern: RegExp, min: number, max: number, errors: ErrorList) {
  const list = readList(input, path, min, max, errors);
  if (!list) return null;
  const ids: string[] = [];
  list.forEach((item, index) => {
    if (typeof item !== "string" || !pattern.test(item)) {
      errors.push(issue(`${path}.${index}`, "invalid_gid", "Invalid Shopify id."));
      return;
    }
    ids.push(item);
  });
  return ids.length === list.length ? ids : null;
}

function readExtensions(input: unknown, path: string, errors: ErrorList) {
  if (input == null) return { value: null };
  if (!isJsonValue(input) || Array.isArray(input) || typeof input !== "object") {
    errors.push(issue(path, "invalid_type", "Extensions must be an object."));
    return null;
  }
  return { value: input as { [key: string]: JsonValue } };
}

function readTemplate(input: unknown, path: string, errors: ErrorList) {
  const text = readText(input, path, 0, LIMITS.template, errors);
  if (text == null) return null;
  const without = text.replace(TOKEN, (_match, name: string) => {
    if (!TEXT_VARIABLE_SET.has(name)) errors.push(issue(path, "unknown_variable", `Unknown text variable {{${name}}}.`));
    return "";
  });
  if (without.includes("{{") || without.includes("}}")) errors.push(issue(path, "invalid_template", "Text template has an invalid variable."));
  return text;
}

function readChoices(input: unknown, path: string, required: boolean, errors: ErrorList) {
  if (!Array.isArray(input)) {
    errors.push(issue(path, "invalid_type", "Choices must be a list."));
    return null;
  }
  if (required && input.length === 0) errors.push(issue(path, "empty", "Choice fields need at least one choice."));
  if (!required && input.length > 0) errors.push(issue(path, "invalid_type", "Only choice fields can have choices."));
  const choices: string[] = [];
  input.forEach((choice, index) => {
    const text = readText(choice, `${path}.${index}`, 1, LIMITS.choice, errors);
    if (text) choices.push(text);
  });
  return choices.length === input.length ? choices : null;
}

function readList(input: unknown, path: string, min: number, max: number, errors: ErrorList) {
  if (!Array.isArray(input)) {
    errors.push(issue(path, "invalid_type", "Expected a list."));
    return null;
  }
  if (input.length < min) errors.push(issue(path, "empty", "This list is incomplete."));
  if (input.length > max) errors.push(issue(path, "too_many", "This list is too long."));
  return input.length >= min && input.length <= max ? input : null;
}

function readId(input: unknown, path: string, errors: ErrorList) {
  if (typeof input !== "string" || !ID_PATTERN.test(input)) {
    errors.push(issue(path, "invalid_id", "Id must be a stable letter or number token."));
    return null;
  }
  return input;
}

function readQuantity(input: unknown, path: string, errors: ErrorList) {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > LIMITS.quantity) {
    errors.push(issue(path, "invalid_quantity", "Quantity must be a whole number from 1 to 999."));
    return null;
  }
  return input;
}

function readBoolean(input: unknown, path: string, errors: ErrorList) {
  if (typeof input !== "boolean") {
    errors.push(issue(path, "invalid_type", "Expected true or false."));
    return null;
  }
  return input;
}

function readText(input: unknown, path: string, min: number, max: number, errors: ErrorList) {
  if (typeof input !== "string") {
    errors.push(issue(path, "invalid_type", "Expected text."));
    return null;
  }
  const trimmed = input.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push(issue(path, "invalid_length", "Text length is outside the allowed range."));
    return null;
  }
  return trimmed;
}

function readNullableText(input: unknown, path: string, max: number, errors: ErrorList) {
  if (input == null) return null;
  return readText(input, path, 0, max, errors);
}

function readObject(input: unknown, path: string, errors: ErrorList) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push(issue(path, "invalid_type", "Expected an object."));
    return null;
  }
  return input as RecordValue;
}

function rejectUnknown(record: RecordValue, allowed: string[], path: string, errors: ErrorList) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push(issue(`${path}.${key}`, "unknown_field", "Unknown configuration field."));
  }
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value == null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value === "object") {
    return Object.keys(value).every((key) => key !== "__proto__" && key !== "prototype" && key !== "constructor")
      && Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item));
  }
  return false;
}

function rejectSubscriptions(value: unknown, path: string, errors: ErrorList) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSubscriptions(item, `${path}.${index}`, errors));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/subscription/i.test(key)) {
      errors.push(issue(`${path}.${key}`, "unsupported_feature", "Subscriptions are outside the current offer configuration."));
    }
    rejectSubscriptions(child, `${path}.${key}`, errors);
  }
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}
