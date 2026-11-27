import { useState } from "react";
import {
  acceptGroupPricing,
  addBundleProduct,
  moveAdditionalProduct,
  removeBundleProduct,
  updateBundleProduct,
} from "../bundles/bar-edit";
import type { JsonPriceBook, PreviewProduct } from "../bundles/editor-state";
import { formatDecimal, promotionalCompareAt } from "../bundles/money";
import type { ProductBundleBar, ProductBundleProduct } from "../bundles/schema";
import { adminResourcePicker, openResourcePicker, type ResourcePicker } from "./shopify-resource-picker";
import { PricingFields } from "./pricing-fields";

export function ProductRows({
  bar,
  currencyCode,
  catalog,
  priceBook,
  picker = adminResourcePicker,
  onChange,
}: {
  bar: ProductBundleBar;
  currencyCode: string | null;
  catalog: PreviewProduct[];
  priceBook: JsonPriceBook | null;
  picker?: ResourcePicker;
  onChange: (bar: ProductBundleBar) => void;
}) {
  const [message, setMessage] = useState("");

  async function addProduct() {
    const result = await openResourcePicker(
      picker,
      { type: "product", action: "add", multiple: false },
      [],
      "single",
    );
    if (!result.ok) {
      setMessage("Choose one Shopify product.");
      return;
    }
    if (result.cancelled) {
      setMessage("");
      return;
    }
    const resource = result.selection[0];
    if (!resource) {
      setMessage("Choose a Shopify product.");
      return;
    }
    const added = addBundleProduct(bar, resource, catalog);
    if (!added.ok) {
      setMessage(added.message);
      return;
    }
    setMessage("");
    onChange(added.bar);
  }

  return (
    <div className="cod-bundle-config">
      <s-select
        label="Product layout"
        name={`${bar.id}-layout`}
        value={bar.config.layout}
        onChange={(event) => {
          const value = (event.currentTarget as { value?: string }).value;
          if (value === "horizontal" || value === "vertical") onChange({ ...bar, config: { ...bar.config, layout: value } });
        }}
      >
        <s-option value="vertical">Vertical</s-option>
        <s-option value="horizontal">Horizontal</s-option>
      </s-select>
      <s-checkbox
        label="Hide individual product prices"
        name={`${bar.id}-hide-prices`}
        {...(bar.config.hideIndividualPrice ? { checked: true } : {})}
        onChange={(event) => {
          const checked = (event.currentTarget as { checked?: boolean }).checked === true;
          onChange({ ...bar, config: { ...bar.config, hideIndividualPrice: checked } });
        }}
      />
      <s-checkbox
        label="Show products only when selected"
        name={`${bar.id}-show-selected`}
        {...(bar.config.showOnlyWhenSelected ? { checked: true } : {})}
        onChange={(event) => {
          const checked = (event.currentTarget as { checked?: boolean }).checked === true;
          onChange({ ...bar, config: { ...bar.config, showOnlyWhenSelected: checked } });
        }}
      />
      {bar.config.products.map((row) => {
        const known = catalog.find((product) => product.id === row.product.productId);
        const additional = bar.config.products.filter((product) => product.role === "additional");
        const position = additional.findIndex((product) => product.id === row.id);
        return (
          <ProductRow
            key={row.id}
            barId={bar.id}
            row={row}
            title={known?.title ?? "Selected product"}
            imageUrl={known?.featuredImageUrl ?? null}
            imageAlt={known?.featuredImageAlt ?? known?.title ?? "Product"}
            known={known ?? null}
            currencyCode={currencyCode}
            compareAt={compareAtCopy(row, priceBook)}
            canMoveUp={row.role === "additional" && position > 0}
            canMoveDown={row.role === "additional" && position >= 0 && position < additional.length - 1}
            onSave={(next) => {
              const updated = savedRow(bar, next, known ?? null);
              if (updated === bar) return false;
              onChange(updated);
              return true;
            }}
            onRemove={() => {
              const updated = removeBundleProduct(bar, row.id);
              if (updated.type === "product_bundle") onChange(updated);
            }}
            onMove={(direction) => {
              const updated = moveAdditionalProduct(bar, row.id, direction);
              if (updated.type === "product_bundle") onChange(updated);
            }}
          />
        );
      })}
      <s-button variant="secondary" onClick={() => void addProduct()}>Add product</s-button>
      {message ? <s-text>{message}</s-text> : null}
    </div>
  );
}

function savedRow(bar: ProductBundleBar, row: ProductBundleProduct, known: PreviewProduct | null) {
  if (known?.variantsComplete) {
    const ids = new Set(known.variants.map((variant) => variant.id));
    if (!row.product.allowedVariantIds.every((id) => ids.has(id))) return bar;
    const selected = known.variants.find((variant) => variant.id === row.product.selectedVariantId);
    if (!selected?.availableForSale) return bar;
  }
  const next = updateBundleProduct(bar, row);
  return next.type === "product_bundle" ? next : bar;
}

function ProductRow({
  barId,
  row,
  title,
  imageUrl,
  imageAlt,
  known,
  currencyCode,
  compareAt,
  canMoveUp,
  canMoveDown,
  onSave,
  onRemove,
  onMove,
}: {
  barId: string;
  row: ProductBundleProduct;
  title: string;
  imageUrl: string | null;
  imageAlt: string;
  known: PreviewProduct | null;
  currencyCode: string | null;
  compareAt: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (row: ProductBundleProduct) => boolean;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const modalId = `product-config-${barId}-${row.id}`;
  const [draft, setDraft] = useState(row);
  const [session, setSession] = useState(0);
  const [error, setError] = useState("");
  const variants = known?.variantsComplete ? known.variants : row.product.allowedVariantIds.map((id) => ({
    id,
    title: "Variant",
    availableForSale: true,
  }));

  function open() {
    setDraft(row);
    setError("");
    setSession((current) => current + 1);
  }

  function commit() {
    if (known && !known.variantsComplete) {
      setError("Shopify did not return every variant, so variant choices stay unchanged.");
      return;
    }
    if (draft.product.allowedVariantIds.length === 0 || !draft.product.allowedVariantIds.includes(draft.product.selectedVariantId)) {
      setError("The default variant must be one of the allowed variants.");
      return;
    }
    const selected = variants.find((variant) => variant.id === draft.product.selectedVariantId);
    if (known?.variantsComplete && !selected?.availableForSale) {
      setError("Choose an available default variant.");
      return;
    }
    if (!onSave(draft)) {
      setError("The default variant must belong to the allowed variants.");
      return;
    }
    setError("");
    const modal = document.getElementById(modalId) as { hide?: () => void } | null;
    modal?.hide?.();
  }

  return (
    <div className="cod-bundle-row">
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
        {imageUrl ? <s-thumbnail src={imageUrl} alt={imageAlt} size="small" /> : <s-icon type="product" />}
        <div>
          <s-text>{row.role === "default" ? "Default product" : "Additional product"}</s-text>
          <s-text>{title}</s-text>
          <s-text>{compareAt}</s-text>
        </div>
        <s-button variant="secondary" commandFor={modalId} command="--show" onClick={open}>Edit</s-button>
      </s-grid>
      {row.role === "additional" ? (
        <s-grid gridTemplateColumns="auto auto auto" gap="base">
          <s-button variant="tertiary" {...(canMoveUp ? {} : { disabled: true })} onClick={() => onMove(-1)}>Move up</s-button>
          <s-button variant="tertiary" {...(canMoveDown ? {} : { disabled: true })} onClick={() => onMove(1)}>Move down</s-button>
          <s-button variant="tertiary" tone="critical" onClick={onRemove}>Remove</s-button>
        </s-grid>
      ) : null}
      <s-modal id={modalId} heading={title} size="base">
        <s-number-field
          label="Quantity"
          name={`${modalId}-quantity`}
          value={String(draft.quantity)}
          min={1}
          max={999}
          step={1}
          onChange={(event) => {
            const value = wholeNumber(event);
            if (value == null || value < 1 || value > 999) return;
            setDraft({ ...draft, quantity: value });
          }}
        />
        <s-checkbox
          label="Show quantity selector"
          name={`${modalId}-selector`}
          {...(draft.quantitySelector ? { checked: true } : {})}
          onChange={(event) => {
            const checked = (event.currentTarget as { checked?: boolean }).checked === true;
            setDraft({ ...draft, quantitySelector: checked });
          }}
        />
        {known && !known.variantsComplete ? <s-text>Shopify did not return every variant for this product.</s-text> : null}
        {variants.map((variant) => {
          const allowed = draft.product.allowedVariantIds.includes(variant.id);
          return (
            <s-checkbox
              key={variant.id}
              label={variant.availableForSale ? variant.title : `${variant.title} unavailable`}
              name={`${modalId}-variant-${variant.id}`}
              {...(allowed ? { checked: true } : {})}
              {...(known && !known.variantsComplete ? { disabled: true } : {})}
              onChange={(event) => {
                const checked = (event.currentTarget as { checked?: boolean }).checked === true;
                setDraft(toggleVariant(draft, variant.id, checked));
              }}
            />
          );
        })}
        <s-select
          label="Default variant"
          name={`${modalId}-default-variant`}
          value={draft.product.selectedVariantId}
          onChange={(event) => {
            const value = (event.currentTarget as { value?: string }).value;
            if (typeof value === "string" && draft.product.allowedVariantIds.includes(value)) {
              setDraft({ ...draft, product: { ...draft.product, selectedVariantId: value } });
            }
          }}
        >
          {draft.product.allowedVariantIds.map((id) => (
            <s-option key={id} value={id}>{variants.find((variant) => variant.id === id)?.title ?? "Variant"}</s-option>
          ))}
        </s-select>
        <PricingFields
          key={session}
          label="Price"
          kind="group"
          pricing={draft.pricing}
          currencyCode={currencyCode}
          onChange={(next) => {
            const pricing = acceptGroupPricing(next);
            if (pricing) setDraft({ ...draft, pricing });
          }}
        />
        {error ? <s-text>{error}</s-text> : null}
        <s-button slot="primary-action" variant="primary" onClick={commit}>Done</s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={modalId}
          command="--hide"
          onClick={() => {
            setDraft(row);
            setError("");
            setSession((current) => current + 1);
          }}
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}

function toggleVariant(row: ProductBundleProduct, variantId: string, allowed: boolean): ProductBundleProduct {
  const ids = allowed
    ? [...row.product.allowedVariantIds, variantId].filter((id, index, list) => list.indexOf(id) === index)
    : row.product.allowedVariantIds.filter((id) => id !== variantId);
  if (ids.length === 0) return row;
  const selectedVariantId = ids.includes(row.product.selectedVariantId) ? row.product.selectedVariantId : ids[0] ?? row.product.selectedVariantId;
  return { ...row, product: { ...row.product, allowedVariantIds: ids, selectedVariantId } };
}

function compareAtCopy(row: ProductBundleProduct, book: JsonPriceBook | null) {
  const point = book?.variants[row.product.selectedVariantId];
  const compareAt = point?.compareAt;
  const regular = point?.regular;
  const money = promotionalCompareAt(
    compareAt ? { amountMinor: BigInt(compareAt.amountMinor), currencyCode: compareAt.currencyCode, exponent: compareAt.exponent } : null,
    regular ? { amountMinor: BigInt(regular.amountMinor), currencyCode: regular.currencyCode, exponent: regular.exponent } : null,
  );
  if (!money) return "Shopify has not returned a compare-at price for the selected variant.";
  return `Compare-at price ${formatDecimal(money)} ${money.currencyCode} for one item.`;
}

function wholeNumber(event: { currentTarget: EventTarget }) {
  const value = (event.currentTarget as { value?: string }).value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

