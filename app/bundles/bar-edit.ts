import { parseDecimal } from "./money";
import type { BundleBar, BundlePricing, GetPricing, GroupPricing, MixAndMatchBar, MixSlot, ProductBundleBar, ProductBundleProduct, StoredMoney, VariantSelection } from "./schema";
import { isCollectionGid, isProductGid, isVariantGid } from "./shopify/ids";
import { buildVariantSelection, type PickerResource } from "./shopify/selection";

type KnownCatalogProduct = {
  id: string;
  variantsComplete: boolean;
  variants: Array<{ id: string; availableForSale: boolean }>;
};

export type SharedPricing = GroupPricing | GetPricing | BundlePricing;

export function moveBar<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function duplicateBar(bar: BundleBar, id: string): BundleBar {
  const copy = structuredClone(bar);
  copy.id = id;
  copy.selectedByDefault = false;
  copy.title = copy.title ? `${copy.title} copy`.slice(0, 120) : copy.title;
  if (copy.type === "product_bundle") {
    copy.config.products = copy.config.products.map((product, index) => ({ ...product, id: `${id}p${index}` }));
  }
  if (copy.type === "mix_and_match") {
    copy.config.slots = copy.config.slots.map((slot, index) => ({ ...slot, id: `${id}s${index}` }));
  }
  copy.upsells = copy.upsells.map((item, index) => ({ ...item, id: `${id}u${index}` }));
  copy.gifts = { ...copy.gifts, items: copy.gifts.items.map((item, index) => ({ ...item, id: `${id}g${index}` })) };
  copy.highlights = copy.highlights.map((item, index) => ({ ...item, id: `${id}h${index}` }));
  copy.personalisation = {
    ...copy.personalisation,
    fields: copy.personalisation.fields.map((field, index) => ({ ...field, id: `${id}f${index}` })),
  };
  return copy;
}

export function newBarId(existing: string[]) {
  const taken = new Set(existing);
  let id = "";
  do {
    id = `bar${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

export function pricingScope(kind: "group" | "get" | "deal", mode: SharedPricing["mode"]) {
  if (mode === "full_price") return null;
  if (mode === "percentage_off") return kind === "deal" ? "per_deal" : "per_line";
  if (mode === "amount_off") return kind === "deal" ? "per_deal" : "per_item";
  return kind === "deal" ? "per_deal" : "per_group";
}

export function emptyPricing(kind: "group" | "get" | "deal", mode: "full_price" | "percentage_off" | "amount_off" | "fixed_price", currencyCode: string): SharedPricing | null {
  if (kind === "get" && mode === "full_price") return null;
  if (mode === "full_price") return { mode: "full_price" };
  if (mode === "percentage_off") {
    const scope = pricingScope(kind, mode);
    return scope === "per_deal"
      ? { mode, basisPoints: 0, scope: "per_deal" }
      : { mode, basisPoints: 0, scope: "per_line" };
  }
  const scope = pricingScope(kind, mode);
  const amount: StoredMoney = { amountMinor: "0", currencyCode };
  if (scope === "per_deal") return { mode, amount, scope: "per_deal" };
  if (scope === "per_item") return { mode: "amount_off", amount, scope: "per_item" };
  return { mode: "fixed_price", amount, scope: "per_group" };
}

export function basisPointsFromPercent(value: string) {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) return null;
  return basisPoints;
}

export function percentFromBasisPoints(basisPoints: number) {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return String(whole);
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}`;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function storedAmount(value: string, currencyCode: string): StoredMoney | null {
  const parsed = parseDecimal(value, currencyCode);
  if (!parsed.ok || parsed.value.amountMinor < 0n) return null;
  return { amountMinor: parsed.value.amountMinor.toString(), currencyCode: parsed.value.currencyCode };
}

export function withBarPricing(bar: BundleBar, pricing: SharedPricing, target: "primary" | "get" = "primary"): BundleBar {
  if (target === "get") {
    if (bar.type !== "buy_x_get_y" || pricing.mode === "full_price") return bar;
    if (pricing.mode === "percentage_off" && pricing.scope !== "per_line") return bar;
    if (pricing.mode === "amount_off" && pricing.scope !== "per_item") return bar;
    if (pricing.mode === "fixed_price" && pricing.scope !== "per_group") return bar;
    return { ...bar, config: { ...bar.config, getPricing: pricing } };
  }
  if (bar.type === "product_bundle") {
    if (pricing.mode === "percentage_off" && pricing.scope !== "per_line") return bar;
    return {
      ...bar,
      config: {
        ...bar.config,
        products: bar.config.products.map((product) => product.role === "default" ? { ...product, pricing: pricing as GroupPricing } : product),
      },
    };
  }
  if (bar.type === "mix_and_match") {
    if (pricing.mode !== "full_price" && pricing.scope !== "per_deal") return bar;
    return { ...bar, pricing: pricing as BundlePricing };
  }
  if (pricing.mode !== "full_price" && pricing.scope === "per_deal") return bar;
  return { ...bar, pricing: pricing as GroupPricing };
}

export function primaryPricing(bar: BundleBar): SharedPricing {
  if (bar.type === "product_bundle") {
    return bar.config.products.find((product) => product.role === "default")?.pricing ?? { mode: "full_price" };
  }
  return bar.pricing;
}

export function pricingKind(bar: BundleBar): "group" | "deal" {
  return bar.type === "mix_and_match" ? "deal" : "group";
}

export function newProductRowId(existing: string[]) {
  const taken = new Set(existing);
  let id = "";
  do {
    id = `row${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

export function acceptGroupPricing(pricing: SharedPricing): GroupPricing | null {
  if (pricing.mode === "full_price") return { mode: "full_price" };
  if (pricing.mode === "percentage_off" && pricing.scope === "per_line") return pricing;
  if (pricing.mode === "amount_off" && pricing.scope === "per_item") return pricing;
  if (pricing.mode === "fixed_price" && pricing.scope === "per_group") return pricing;
  return null;
}

export function addBundleProduct(
  bar: BundleBar,
  resource: PickerResource,
  catalog: KnownCatalogProduct[],
): { ok: true; bar: ProductBundleBar } | { ok: false; message: string } {
  if (bar.type !== "product_bundle") return { ok: false, message: "This offer is not a product bundle." };
  if (!isProductGid(resource.id)) return { ok: false, message: "Choose a Shopify product." };
  const variantIds = resource.variants.map((variant) => variant.id).filter((id) => isVariantGid(id));
  if (variantIds.length === 0) return { ok: false, message: "Choose a product variant before adding the product." };
  const known = catalog.find((product) => product.id === resource.id);
  if (known && !known.variantsComplete) {
    return { ok: false, message: "Shopify did not return every variant, so this product was not added." };
  }
  const selection = known
    ? buildVariantSelection(
      resource.id,
      known.variants.filter((variant) => variantIds.includes(variant.id)).map((variant) => ({ id: variant.id, available: variant.availableForSale })),
      null,
    )
    : { ok: true as const, selection: { productId: resource.id, allowedVariantIds: variantIds, selectedVariantId: variantIds[0] ?? "" } };
  if (!selection.ok) {
    return { ok: false, message: "This product has no available variant to add." };
  }
  const row: ProductBundleProduct = {
    id: newProductRowId(bar.config.products.map((product) => product.id)),
    role: "additional",
    product: selection.selection,
    quantity: 1,
    quantitySelector: false,
    pricing: { mode: "full_price" },
  };
  return { ok: true, bar: { ...bar, config: { ...bar.config, products: [...bar.config.products, row] } } };
}

export function updateBundleProduct(bar: BundleBar, row: ProductBundleProduct): BundleBar {
  if (bar.type !== "product_bundle") return bar;
  const current = bar.config.products.find((product) => product.id === row.id);
  const pricing = acceptGroupPricing(row.pricing);
  if (!current || current.role !== row.role || current.product.productId !== row.product.productId || !pricing) return bar;
  if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 999) return bar;
  if (row.product.allowedVariantIds.length === 0 || !row.product.allowedVariantIds.includes(row.product.selectedVariantId)) return bar;
  return {
    ...bar,
    config: {
      ...bar.config,
      products: bar.config.products.map((product) => product.id === row.id ? { ...row, pricing } : product),
    },
  };
}

export function removeBundleProduct(bar: BundleBar, rowId: string): BundleBar {
  if (bar.type !== "product_bundle") return bar;
  const row = bar.config.products.find((product) => product.id === rowId);
  if (!row || row.role !== "additional") return bar;
  return { ...bar, config: { ...bar.config, products: bar.config.products.filter((product) => product.id !== rowId) } };
}

export function addMixSlot(
  bar: BundleBar,
  resource: PickerResource,
  catalog: KnownCatalogProduct[],
): { ok: true; bar: MixAndMatchBar } | { ok: false; message: string } {
  if (bar.type !== "mix_and_match") return { ok: false, message: "This offer is not a mix and match bundle." };
  const selection = selectionFromPicker(resource, catalog);
  if (!selection.ok) return selection;
  const slot: MixSlot = {
    id: newProductRowId(bar.config.slots.map((item) => item.id)),
    role: "additional",
    title: "{{product}}",
    product: selection.selection,
    swapProducts: [],
    swapCollectionIds: [],
  };
  return { ok: true, bar: { ...bar, config: { ...bar.config, slots: [...bar.config.slots, slot] } } };
}

export function updateMixSlot(bar: BundleBar, slot: MixSlot): BundleBar {
  if (bar.type !== "mix_and_match") return bar;
  const current = bar.config.slots.find((item) => item.id === slot.id);
  if (!current || current.role !== slot.role || current.product.productId !== slot.product.productId) return bar;
  if (slot.title.length > 120) return bar;
  const product = cleanSelection(slot.product);
  const cleanedSwaps = slot.swapProducts.map(cleanSelection);
  if (!product || cleanedSwaps.some((item) => item == null) || slot.swapCollectionIds.some((id) => !isCollectionGid(id))) return bar;
  const swapProducts = dedupeSelections(cleanedSwaps.filter((item): item is VariantSelection => item != null));
  const swapCollectionIds = [...new Set(slot.swapCollectionIds)];
  return {
    ...bar,
    config: {
      ...bar.config,
      slots: bar.config.slots.map((item) => item.id === slot.id ? { ...slot, title: slot.title, product, swapProducts, swapCollectionIds } : item),
    },
  };
}

export function removeMixSlot(bar: BundleBar, slotId: string): BundleBar {
  if (bar.type !== "mix_and_match") return bar;
  const slot = bar.config.slots.find((item) => item.id === slotId);
  if (!slot || slot.role !== "additional") return bar;
  return { ...bar, config: { ...bar.config, slots: bar.config.slots.filter((item) => item.id !== slotId) } };
}

export function moveAdditionalSlot(bar: BundleBar, slotId: string, direction: -1 | 1): BundleBar {
  if (bar.type !== "mix_and_match") return bar;
  const additional = bar.config.slots.filter((slot) => slot.role === "additional");
  const from = additional.findIndex((slot) => slot.id === slotId);
  const moved = moveBar(additional, from, from + direction);
  if (moved === additional) return bar;
  let index = 0;
  return {
    ...bar,
    config: {
      ...bar.config,
      slots: bar.config.slots.map((slot) => slot.role === "additional" ? moved[index++]! : slot),
    },
  };
}

export function configureAlternativeProduct(
  bar: BundleBar,
  config: { product: VariantSelection; quantity: number },
  catalog: KnownCatalogProduct[],
): { ok: true; bar: BundleBar } | { ok: false; message: string } {
  if (bar.type !== "alternative_product") return { ok: false, message: "This bar is not an alternative product." };
  if (!Number.isInteger(config.quantity) || config.quantity < 1 || config.quantity > 999) {
    return { ok: false, message: "Enter a whole quantity from 1 to 999." };
  }
  if (!isProductGid(config.product.productId)) return { ok: false, message: "Choose a Shopify product." };
  const known = catalog.find((product) => product.id === config.product.productId);
  if (known && !known.variantsComplete) {
    return { ok: false, message: "Shopify did not return every variant, so variant choices stay unchanged." };
  }
  const allowedVariantIds = [...new Set(config.product.allowedVariantIds.filter((id) => isVariantGid(id)))];
  if (allowedVariantIds.length === 0) return { ok: false, message: "Keep at least one variant." };
  if (!allowedVariantIds.includes(config.product.selectedVariantId)) {
    return { ok: false, message: "The default variant must be one of the allowed variants." };
  }
  if (known) {
    const catalogIds = new Set(known.variants.map((variant) => variant.id));
    if (allowedVariantIds.some((id) => !catalogIds.has(id))) {
      return { ok: false, message: "A selected variant does not belong to this product." };
    }
    const selected = known.variants.find((variant) => variant.id === config.product.selectedVariantId);
    if (!selected?.availableForSale) return { ok: false, message: "Choose an available default variant." };
  }
  return {
    ok: true,
    bar: {
      ...bar,
      config: {
        product: { productId: config.product.productId, allowedVariantIds, selectedVariantId: config.product.selectedVariantId },
        quantity: config.quantity,
      },
    },
  };
}

export function selectionFromPicker(
  resource: PickerResource,
  catalog: KnownCatalogProduct[],
): { ok: true; selection: VariantSelection } | { ok: false; message: string } {
  if (!isProductGid(resource.id)) return { ok: false, message: "Choose a Shopify product." };
  const variantIds = resource.variants.map((variant) => variant.id).filter((id) => isVariantGid(id));
  if (variantIds.length === 0) return { ok: false, message: "Choose a product variant before adding the product." };
  const known = catalog.find((product) => product.id === resource.id);
  if (known && !known.variantsComplete) {
    return { ok: false, message: "Shopify did not return every variant, so this product was not added." };
  }
  const selection = known
    ? buildVariantSelection(
      resource.id,
      known.variants.filter((variant) => variantIds.includes(variant.id)).map((variant) => ({ id: variant.id, available: variant.availableForSale })),
      null,
    )
    : { ok: true as const, selection: { productId: resource.id, allowedVariantIds: variantIds, selectedVariantId: variantIds[0] ?? "" } };
  if (!selection.ok) return { ok: false, message: "This product has no available variant to add." };
  return { ok: true, selection: selection.selection };
}

function cleanSelection(selection: VariantSelection): VariantSelection | null {
  if (!isProductGid(selection.productId)) return null;
  const allowedVariantIds = [...new Set(selection.allowedVariantIds.filter((id) => isVariantGid(id)))];
  if (allowedVariantIds.length === 0 || !allowedVariantIds.includes(selection.selectedVariantId)) return null;
  return { productId: selection.productId, allowedVariantIds, selectedVariantId: selection.selectedVariantId };
}

function dedupeSelections(selections: VariantSelection[]) {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    if (seen.has(selection.productId)) return false;
    seen.add(selection.productId);
    return true;
  });
}

export function moveAdditionalProduct(bar: BundleBar, rowId: string, direction: -1 | 1): BundleBar {
  if (bar.type !== "product_bundle") return bar;
  const additional = bar.config.products.filter((product) => product.role === "additional");
  const from = additional.findIndex((product) => product.id === rowId);
  const moved = moveBar(additional, from, from + direction);
  if (moved === additional) return bar;
  let index = 0;
  return {
    ...bar,
    config: {
      ...bar.config,
      products: bar.config.products.map((product) => product.role === "additional" ? moved[index++]! : product),
    },
  };
}
