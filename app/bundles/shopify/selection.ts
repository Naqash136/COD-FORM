export const SELECTION_PURPOSES = [
  "quantity_break",
  "buy_x_get_y",
  "product_bundle",
  "mix_and_match",
  "alternative_product",
  "upsell",
  "gift",
  "targeting_product",
  "targeting_collection",
  "swap_product",
  "swap_collection",
] as const;

export type SelectionPurpose = (typeof SELECTION_PURPOSES)[number];
export type SelectionCardinality = "none" | "single" | "multiple";

export type SelectionRule = {
  purpose: SelectionPurpose;
  products: SelectionCardinality;
  variants: SelectionCardinality;
  collections: SelectionCardinality;
};

export type PickerResource = {
  id: string;
  title: string;
  variants: Array<{ id: string; title: string }>;
};

const RULES: Record<SelectionPurpose, SelectionRule> = {
  quantity_break: { purpose: "quantity_break", products: "single", variants: "multiple", collections: "none" },
  buy_x_get_y: { purpose: "buy_x_get_y", products: "single", variants: "multiple", collections: "none" },
  product_bundle: { purpose: "product_bundle", products: "multiple", variants: "multiple", collections: "none" },
  mix_and_match: { purpose: "mix_and_match", products: "single", variants: "multiple", collections: "none" },
  alternative_product: { purpose: "alternative_product", products: "single", variants: "multiple", collections: "none" },
  upsell: { purpose: "upsell", products: "single", variants: "multiple", collections: "none" },
  gift: { purpose: "gift", products: "single", variants: "multiple", collections: "none" },
  targeting_product: { purpose: "targeting_product", products: "multiple", variants: "none", collections: "none" },
  targeting_collection: { purpose: "targeting_collection", products: "none", variants: "none", collections: "multiple" },
  swap_product: { purpose: "swap_product", products: "multiple", variants: "multiple", collections: "none" },
  swap_collection: { purpose: "swap_collection", products: "none", variants: "none", collections: "multiple" },
};

export function selectionRule(purpose: SelectionPurpose, override?: Partial<Omit<SelectionRule, "purpose">>): SelectionRule {
  return { ...RULES[purpose], ...override, purpose };
}

export type PickerApplication =
  | { ok: true; changed: boolean; selection: PickerResource[]; cancelled: boolean }
  | { ok: false; code: "too_many" | "unsupported"; selection: PickerResource[] };

export function applyPickerResult(
  current: PickerResource[],
  picked: PickerResource[] | undefined,
  cardinality: SelectionCardinality,
): PickerApplication {
  if (picked === undefined) return { ok: true, changed: false, selection: current, cancelled: true };
  if (cardinality === "none") return { ok: false, code: "unsupported", selection: current };
  if (cardinality === "single" && picked.length > 1) return { ok: false, code: "too_many", selection: current };
  return { ok: true, changed: true, selection: picked, cancelled: false };
}

export function removePickerResource(current: PickerResource[], id: string) {
  return current.filter((resource) => resource.id !== id);
}

export type VariantCandidate = {
  id: string;
  available: boolean;
};

export function buildVariantSelection(
  productId: string,
  allowed: VariantCandidate[],
  preselectedId: string | null,
) {
  const allowedIds = allowed.map((variant) => variant.id);
  if (preselectedId && !allowedIds.includes(preselectedId)) {
    return { ok: false as const, code: "preselection_not_allowed" as const };
  }
  if (preselectedId) {
    const chosen = allowed.find((variant) => variant.id === preselectedId);
    if (!chosen?.available) return { ok: false as const, code: "unavailable_preselection" as const };
    return {
      ok: true as const,
      selection: { productId, allowedVariantIds: allowedIds, selectedVariantId: preselectedId },
    };
  }
  const available = allowed.find((variant) => variant.available);
  if (!available) return { ok: false as const, code: "no_available_variant" as const };
  return {
    ok: true as const,
    selection: { productId, allowedVariantIds: allowedIds, selectedVariantId: available.id },
  };
}

export function customerVariantChoice(
  allowedVariantIds: string[],
  availableVariantIds: string[],
  configuredVariantId: string,
  requestedVariantId?: string,
) {
  const variantId = requestedVariantId ?? configuredVariantId;
  if (!allowedVariantIds.includes(variantId)) return { ok: false as const, code: "variant_not_allowed" as const };
  if (!availableVariantIds.includes(variantId)) return { ok: false as const, code: "unavailable_variant" as const };
  return { ok: true as const, variantId };
}
