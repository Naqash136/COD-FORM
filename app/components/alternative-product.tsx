import { useState } from "react";
import { configureAlternativeProduct, selectionFromPicker } from "../bundles/bar-edit";
import type { AlternativeProductBar } from "../bundles/schema";
import type { PreviewProduct } from "../bundles/editor-state";
import { adminResourcePicker, openResourcePicker, type ResourcePicker } from "./shopify-resource-picker";

export function AlternativeProductFields({
  bar,
  catalog,
  picker = adminResourcePicker,
  onChange,
}: {
  bar: AlternativeProductBar;
  catalog: PreviewProduct[];
  picker?: ResourcePicker;
  onChange: (bar: AlternativeProductBar) => void;
}) {
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const known = catalog.find((product) => product.id === bar.config.product.productId) ?? null;
  const variants = known?.variantsComplete
    ? known.variants
    : bar.config.product.allowedVariantIds.map((id) => ({
      id,
      title: "Variant",
      availableForSale: true,
    }));

  function apply(product: AlternativeProductBar["config"]["product"], quantity: number) {
    const result = configureAlternativeProduct(bar, { product, quantity }, catalog);
    if (!result.ok || result.bar.type !== "alternative_product") {
      setMessage(result.ok ? "This bar is not an alternative product." : result.message);
      setRevision((current) => current + 1);
      return;
    }
    setMessage("");
    onChange(result.bar);
  }

  async function changeProduct() {
    const current = [{
      id: bar.config.product.productId,
      title: known?.title ?? "Selected product",
      variants: bar.config.product.allowedVariantIds.map((id) => ({
        id,
        title: known?.variants.find((variant) => variant.id === id)?.title ?? "Variant",
      })),
    }];
    const result = await openResourcePicker(
      picker,
      {
        type: "product",
        action: "select",
        multiple: false,
        selectionIds: current.map((item) => ({ id: item.id, variants: item.variants.map((variant) => ({ id: variant.id })) })),
      },
      current,
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
    const selection = selectionFromPicker(resource, catalog);
    if (!selection.ok) {
      setMessage(selection.message);
      return;
    }
    apply(selection.selection, bar.config.quantity);
  }

  function toggleVariant(variantId: string, allowed: boolean) {
    const ids = allowed
      ? [...bar.config.product.allowedVariantIds, variantId]
      : bar.config.product.allowedVariantIds.filter((id) => id !== variantId);
    const allowedVariantIds = [...new Set(ids)];
    const selectedVariantId = allowedVariantIds.includes(bar.config.product.selectedVariantId)
      ? bar.config.product.selectedVariantId
      : allowedVariantIds[0] ?? bar.config.product.selectedVariantId;
    apply({ ...bar.config.product, allowedVariantIds, selectedVariantId }, bar.config.quantity);
  }

  return (
    <div className="cod-bundle-row">
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
        {known?.featuredImageUrl ? <s-thumbnail src={known.featuredImageUrl} alt={known.featuredImageAlt ?? known.title} size="small" /> : <s-icon type="product" />}
        <s-text>{known?.title ?? "Selected product"}</s-text>
        <s-button variant="secondary" onClick={() => void changeProduct()}>Change product</s-button>
      </s-grid>
      {known && !known.variantsComplete ? <s-text>Shopify did not return every variant for this product.</s-text> : null}
      <div key={revision}>
      {variants.map((variant) => {
        const allowed = bar.config.product.allowedVariantIds.includes(variant.id);
        return (
          <s-checkbox
            key={variant.id}
            label={variant.availableForSale ? variant.title : `${variant.title} unavailable`}
            name={`${bar.id}-allowed-${variant.id}`}
            {...(allowed ? { checked: true } : {})}
            {...(known && !known.variantsComplete ? { disabled: true } : {})}
            onChange={(event) => {
              const checked = (event.currentTarget as { checked?: boolean }).checked === true;
              toggleVariant(variant.id, checked);
            }}
          />
        );
      })}
      </div>
      <s-select
        label="Default variant"
        name={`${bar.id}-default-variant`}
        value={bar.config.product.selectedVariantId}
        onChange={(event) => {
          const value = (event.currentTarget as { value?: string }).value;
          if (typeof value === "string") apply({ ...bar.config.product, selectedVariantId: value }, bar.config.quantity);
        }}
      >
        {bar.config.product.allowedVariantIds.map((id) => (
          <s-option key={id} value={id}>{variants.find((variant) => variant.id === id)?.title ?? "Variant"}</s-option>
        ))}
      </s-select>
      <s-number-field
        label="Quantity"
        name={`${bar.id}-alternative-quantity`}
        value={String(bar.config.quantity)}
        min={1}
        max={999}
        step={1}
        onChange={(event) => {
          const value = (event.currentTarget as { value?: string }).value;
          if (typeof value !== "string" || !/^\d+$/.test(value)) return;
          apply(bar.config.product, Number(value));
        }}
      />
      {message ? <s-text>{message}</s-text> : null}
    </div>
  );
}
