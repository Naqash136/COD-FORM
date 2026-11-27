export const SCHEMA_VERSION = 1 as const;

export const BAR_TYPES = [
  "quantity_break",
  "buy_x_get_y",
  "product_bundle",
  "mix_and_match",
  "alternative_product",
] as const;

export type BarType = (typeof BAR_TYPES)[number];

/**
 * Saved templates keep these tokens. {{product}} is the merchant name for
 * {{product_title}}. Customer-facing {{savings}} and {{saved_amount}} use
 * compare-at savings when every line has a compare-at price strictly above
 * its regular unit price, and otherwise use discount savings from the regular
 * total. They are never added together and are never negative. When coverage
 * is complete, compare-at savings are the compare-at total minus the final
 * total. A compare-at price at or below the regular unit price is not a
 * promotional reference.
 * {{saved_percentage}} uses that same reference price.
 * {{discount}} remains the applied discount from the regular price.
 * {{quantity}} is the combined merchandise quantity. On a buy-x-get-y bar that
 * is the buy quantity plus the get quantity. {{buy_quantity}} and
 * {{get_quantity}} are those two groups. They are empty on other bar types.
 */
export const TEXT_VARIABLES = [
  "product_title",
  "product",
  "quantity",
  "buy_quantity",
  "get_quantity",
  "regular_price",
  "compare_at_price",
  "final_price",
  "discount",
  "savings",
  "saved_amount",
  "saved_percentage",
  "currency",
] as const;

export type StoredMoney = {
  amountMinor: string;
  currencyCode: string;
};

/**
 * Quantity break fixed price is the total for the configured quantity.
 * The customer total is roundHalfUp(fixedTotal * customerQuantity / configuredQuantity).
 * Buy and get fixed prices replace that quantity group's total.
 * Mix and match amount off and fixed price apply once to the whole bundle.
 * Product-bundle and alternative amount off are per item, and their fixed price
 * is the total for that product's quantity. Those two scopes were not given a
 * separate competitor example and are stated here so they are not implied silently.
 */
export const PRICING_RULES = {
  quantityBreakFixed:
    "Fixed price is the total for the configured quantity. A different customer quantity scales that total and rounds half up.",
  buyGetAmount: "Amount off applies per item in the buy group or the get group.",
  buyGetFixed: "Fixed price replaces the total for the buy quantity group or the get quantity group.",
  mixAmount: "Amount off is subtracted once from the complete mix-and-match bundle.",
  mixFixed: "Fixed price replaces the complete bundle total and does not change when a slot product is swapped.",
  productBundleAssumption:
    "Each product bundle product has its own price. Amount off is per item. Fixed price is that product's quantity total.",
  alternativeAssumption:
    "Amount off is per item. Fixed price is the total for the alternative product's quantity.",
} as const;

/**
 * Shopify remains authoritative for current product data, prices, and availability.
 * Bar configuration remains authoritative for the products and variants an offer allows.
 * A customer can select any allowed variant that Shopify currently reports as available.
 * A collection swap is accepted only after Shopify confirms collection membership.
 * An unavailable variant cannot be purchased, regardless of sold-out styling.
 * Amount-off and fixed-price scopes stay as defined above.
 * Products, Settings, Style, and shared modal details are specified when those screens are built.
 */
export const CONFIGURATION_AUTHORITY = {
  productData: "Shopify is authoritative for current product data, prices, and availability.",
  barConfiguration: "Bar configuration is authoritative for allowed products and variants.",
  variantSelection: "A customer can select any allowed variant that is currently available.",
  collectionSwaps: "Collection swaps require Shopify collection membership.",
  unavailableVariants: "Unavailable variants cannot be purchased, regardless of sold-out styling.",
  pricingScopes: "Amount-off and fixed-price scopes remain the scopes defined for each bar.",
  laterScreens: "Products, Settings, Style, and modal details are specified with those screens.",
} as const;

export type GroupPricing =
  | { mode: "full_price" }
  | { mode: "percentage_off"; basisPoints: number; scope: "per_line" }
  | { mode: "amount_off"; amount: StoredMoney; scope: "per_item" }
  | { mode: "fixed_price"; amount: StoredMoney; scope: "per_group" };

export type GetPricing =
  | { mode: "percentage_off"; basisPoints: number; scope: "per_line" }
  | { mode: "amount_off"; amount: StoredMoney; scope: "per_item" }
  | { mode: "fixed_price"; amount: StoredMoney; scope: "per_group" };

export type BundlePricing =
  | { mode: "full_price" }
  | { mode: "percentage_off"; basisPoints: number; scope: "per_deal" }
  | { mode: "amount_off"; amount: StoredMoney; scope: "per_deal" }
  | { mode: "fixed_price"; amount: StoredMoney; scope: "per_deal" };

export type PricingConfig = GroupPricing | BundlePricing;

export type VariantSelection = {
  productId: string;
  allowedVariantIds: string[];
  selectedVariantId: string;
};

export type CatalogProduct = {
  id: string;
  product: VariantSelection;
};

export type CatalogImageRef = {
  source: "catalog";
  productId: string;
  url: string;
  alt: string | null;
};

export type CompositionImageItem = {
  productId: string;
  url: string;
  alt: string | null;
};

export type CompositionImageRef = {
  source: "composition";
  alt: string | null;
  items: CompositionImageItem[];
};

export type ImageRef =
  | { source: "product"; productId: string; alt: string | null }
  | { source: "file"; fileId: string; alt: string | null }
  | { source: "url"; url: string; alt: string | null }
  | CatalogImageRef
  | CompositionImageRef;

export type PersonalisationField = {
  id: string;
  label: string;
  inputType: "text" | "number" | "choice";
  required: boolean;
  choices: string[];
};

export type Highlight = {
  id: string;
  text: string;
  icon: ImageRef | null;
};

export type Upsell = {
  id: string;
  kind: "manual" | "complementary";
  product: VariantSelection;
  quantity: number;
  pricing: GroupPricing;
};

export type GiftItem = {
  id: string;
  product: VariantSelection;
  quantity: number;
};

export type GiftConfig = {
  selection: "single" | "multiple";
  items: GiftItem[];
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SoldOutAppearance = "hide" | "show_unavailable" | "show_selectable";

export type BarBase = {
  id: string;
  title: string;
  subtitle: string;
  label: string;
  textTemplate: string;
  selectedByDefault: boolean;
  images: {
    customBarImage: ImageRef | null;
    featuredImage: ImageRef | null;
    barImageSize: number;
    barImageRadius: number;
  };
  upsells: Upsell[];
  gifts: GiftConfig;
  freeShipping: {
    enabled: boolean;
    maximumRate: StoredMoney | null;
  };
  personalisation: {
    enabled: boolean;
    perUnit: boolean;
    fields: PersonalisationField[];
  };
  highlights: Highlight[];
  soldOut: {
    appearance: SoldOutAppearance;
    restrictSelection: boolean;
  };
  extensions: { [key: string]: JsonValue } | null;
};

export type QuantityBreakBar = BarBase & {
  type: "quantity_break";
  pricing: GroupPricing;
  config: {
    product: VariantSelection;
    quantity: number;
    quantitySelector: boolean;
  };
};

export type BuyXGetYBar = BarBase & {
  type: "buy_x_get_y";
  pricing: GroupPricing;
  config: {
    product: VariantSelection;
    buyQuantity: number;
    getQuantity: number;
    getPricing: GetPricing;
    getProduct: VariantSelection | null;
  };
};

export type ProductBundleProduct = {
  id: string;
  role: "default" | "additional";
  product: VariantSelection;
  quantity: number;
  quantitySelector: boolean;
  pricing: GroupPricing;
};

export type ProductBundleBar = BarBase & {
  type: "product_bundle";
  config: {
    layout: "horizontal" | "vertical";
    hideIndividualPrice: boolean;
    showOnlyWhenSelected: boolean;
    products: ProductBundleProduct[];
  };
};

/**
 * Each slot is one selected product. `title` is the customer-facing row
 * title. The reviewed default is {{product}}, which resolves to the product
 * currently selected in that slot. Customers replace the selection with an
 * allowed alternative; that preview choice is not part of this saved slot.
 */
export type MixSlot = {
  id: string;
  role: "default" | "additional";
  title: string;
  product: VariantSelection;
  swapProducts: VariantSelection[];
  swapCollectionIds: string[];
};

export type MixAndMatchBar = BarBase & {
  type: "mix_and_match";
  pricing: BundlePricing;
  config: {
    showPrices: boolean;
    showOnlyWhenSelected: boolean;
    changeButtonLabel: string;
    selectionModal: {
      title: string;
    };
    slots: MixSlot[];
  };
};

export type AlternativeProductBar = BarBase & {
  type: "alternative_product";
  pricing: GroupPricing;
  config: {
    product: VariantSelection;
    quantity: number;
  };
};

export type BundleBar =
  | QuantityBreakBar
  | BuyXGetYBar
  | ProductBundleBar
  | MixAndMatchBar
  | AlternativeProductBar;

export type BundleDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  products: {
    items: CatalogProduct[];
  };
  settings: {
    extensions: { [key: string]: JsonValue } | null;
  };
  style: {
    extensions: { [key: string]: JsonValue } | null;
  };
  bars: BundleBar[];
  modal: {
    extensions: { [key: string]: JsonValue } | null;
  };
  targeting: {
    productIds: string[];
    collectionIds: string[];
  };
  extensions: { [key: string]: JsonValue } | null;
};

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};
