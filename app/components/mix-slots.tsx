import { useState } from "react";
import {
  addMixSlot,
  moveAdditionalSlot,
  removeMixSlot,
  selectionFromPicker,
  updateMixSlot,
} from "../bundles/bar-edit";
import {
  swapChoices,
  type CollectionPage,
  type JsonPriceBook,
  type PreviewProduct,
  type SwapChoice,
} from "../bundles/editor-state";
import type { MixAndMatchBar, MixSlot, VariantSelection } from "../bundles/schema";
import { isCollectionGid } from "../bundles/shopify/ids";
import type { PickerResource } from "../bundles/shopify/selection";
import { adminResourcePicker, openResourcePicker, type ResourcePicker } from "./shopify-resource-picker";

export function MixSlots({
  bar,
  catalog,
  pages = [],
  picker = adminResourcePicker,
  onChange,
}: {
  bar: MixAndMatchBar;
  catalog: PreviewProduct[];
  pages?: CollectionPage[];
  picker?: ResourcePicker;
  onChange: (bar: MixAndMatchBar) => void;
}) {
  const [message, setMessage] = useState("");
  const additional = bar.config.slots.filter((slot) => slot.role === "additional");

  async function addProduct() {
    const result = await openResourcePicker(picker, { type: "product", action: "add", multiple: false }, [], "single");
    if (!result.ok || result.cancelled || !result.selection[0]) {
      setMessage(result.ok && result.cancelled ? "" : "Choose one Shopify product.");
      return;
    }
    const added = addMixSlot(bar, result.selection[0], catalog);
    if (!added.ok) {
      setMessage(added.message);
      return;
    }
    setMessage("");
    onChange(added.bar);
  }

  return (
    <div className="cod-bundle-config">
      <s-text>This price applies once to the whole bundle.</s-text>
      <s-text-field
        label="Change button"
        name={`${bar.id}-change`}
        value={bar.config.changeButtonLabel}
        onInput={(event) => {
          const value = (event.currentTarget as { value?: string }).value;
          if (typeof value === "string") onChange({ ...bar, config: { ...bar.config, changeButtonLabel: value.slice(0, 80) } });
        }}
      />
      <s-checkbox
        label="Show product prices"
        name={`${bar.id}-show-prices`}
        {...(bar.config.showPrices ? { checked: true } : {})}
        onChange={(event) => {
          const checked = (event.currentTarget as { checked?: boolean }).checked === true;
          onChange({ ...bar, config: { ...bar.config, showPrices: checked } });
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
      {bar.config.slots.map((slot) => {
        const known = catalog.find((product) => product.id === slot.product.productId);
        const position = additional.findIndex((item) => item.id === slot.id);
        return (
          <MixSlotRow
            key={slot.id}
            barId={bar.id}
            slot={slot}
            known={known ?? null}
            title={known?.title ?? "Selected product"}
            imageUrl={known?.featuredImageUrl ?? null}
            imageAlt={known?.featuredImageAlt ?? known?.title ?? "Product"}
            catalog={catalog}
            pages={pages}
            canMoveUp={slot.role === "additional" && position > 0}
            canMoveDown={slot.role === "additional" && position >= 0 && position < additional.length - 1}
            picker={picker}
            onSave={(next) => {
              const updated = updateMixSlot(bar, next);
              if (updated === bar || updated.type !== "mix_and_match") return false;
              onChange(updated);
              return true;
            }}
            onRemove={() => {
              const updated = removeMixSlot(bar, slot.id);
              if (updated.type === "mix_and_match") onChange(updated);
            }}
            onMove={(direction) => {
              const updated = moveAdditionalSlot(bar, slot.id, direction);
              if (updated.type === "mix_and_match") onChange(updated);
            }}
          />
        );
      })}
      <s-button onClick={() => void addProduct()}>Add product</s-button>
      {message ? <s-text>{message}</s-text> : null}
    </div>
  );
}

function MixSlotRow({
  barId,
  slot,
  known,
  title,
  imageUrl,
  imageAlt,
  catalog,
  pages,
  canMoveUp,
  canMoveDown,
  picker,
  onSave,
  onRemove,
  onMove,
}: {
  barId: string;
  slot: MixSlot;
  known: PreviewProduct | null;
  title: string;
  imageUrl: string | null;
  imageAlt: string;
  catalog: PreviewProduct[];
  pages: CollectionPage[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  picker: ResourcePicker;
  onSave: (slot: MixSlot) => boolean;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const modalId = `mix-config-${barId}-${slot.id}`;
  const [draft, setDraft] = useState(slot);
  const [error, setError] = useState("");
  const [pickerMessage, setPickerMessage] = useState("");
  const variants = (known?.variants ?? slot.product.allowedVariantIds.map((id) => ({
    id,
    title: "Variant",
    availableForSale: true,
  }))).filter((variant) => known ? slot.product.allowedVariantIds.includes(variant.id) || known.variants.some((item) => item.id === variant.id) : true);

  function open() {
    setDraft(slot);
    setError("");
    setPickerMessage("");
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
    const selected = (known?.variants ?? []).find((variant) => variant.id === draft.product.selectedVariantId);
    if (known?.variantsComplete && selected && !selected.availableForSale) {
      setError("Choose an available default variant.");
      return;
    }
    if (!onSave(draft)) {
      setError("This product configuration could not be saved.");
      return;
    }
    setError("");
    const modal = document.getElementById(modalId) as { hide?: () => void } | null;
    modal?.hide?.();
  }

  async function addSwaps(kind: "product" | "collection") {
    const current = kind === "product" ? draft.swapProducts.map(resourceFromSelection) : draft.swapCollectionIds.map((id) => ({ id, title: id, variants: [] }));
    const result = await openResourcePicker(
      picker,
      { type: kind, action: "add", multiple: true, selectionIds: current.map((item) => ({ id: item.id })) },
      current,
      "multiple",
    );
    if (!result.ok) {
      setPickerMessage(kind === "product" ? "Choose Shopify products." : "Choose Shopify collections.");
      return;
    }
    if (result.cancelled) return;
    if (kind === "collection") {
      const ids = result.selection.map((item) => item.id).filter((id) => isCollectionGid(id));
      setDraft({ ...draft, swapCollectionIds: [...new Set(ids)] });
      setPickerMessage("");
      return;
    }
    const selections: VariantSelection[] = [];
    for (const resource of result.selection) {
      const selection = selectionFromPicker(resource, catalog);
      if (!selection.ok) {
        setPickerMessage(selection.message);
        return;
      }
      selections.push(selection.selection);
    }
    setDraft({ ...draft, swapProducts: selections });
    setPickerMessage("");
  }

  const visibleVariants = known?.variants ?? variants;

  return (
    <div className="cod-bundle-row">
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
        {imageUrl ? <s-thumbnail src={imageUrl} alt={imageAlt} size="small" /> : <s-icon type="product" />}
        <div>
          <s-text>{slot.role === "default" ? "Default product" : "Additional product"}</s-text>
          <s-text>{title}</s-text>
          <s-text>{slot.title}</s-text>
        </div>
        <s-button variant="secondary" commandFor={modalId} command="--show" onClick={open}>Edit</s-button>
      </s-grid>
      {slot.role === "additional" ? (
        <s-grid gridTemplateColumns="auto auto auto" gap="base">
          <s-button variant="tertiary" {...(canMoveUp ? {} : { disabled: true })} onClick={() => onMove(-1)}>Move up</s-button>
          <s-button variant="tertiary" {...(canMoveDown ? {} : { disabled: true })} onClick={() => onMove(1)}>Move down</s-button>
          <s-button variant="tertiary" tone="critical" onClick={onRemove}>Remove</s-button>
        </s-grid>
      ) : null}
      <s-modal id={modalId} heading={title} size="base">
        {imageUrl ? <s-thumbnail src={imageUrl} alt={imageAlt} size="small" /> : null}
        <s-text>{title}</s-text>
        {known && !known.variantsComplete ? <s-text>Shopify did not return every variant for this product.</s-text> : null}
        {visibleVariants.map((variant) => {
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
            <s-option key={id} value={id}>{visibleVariants.find((variant) => variant.id === id)?.title ?? "Variant"}</s-option>
          ))}
        </s-select>
        <s-text-field
          label="Product row title"
          name={`${modalId}-title`}
          value={draft.title}
          onInput={(event) => {
            const value = (event.currentTarget as { value?: string }).value;
            if (typeof value === "string") setDraft({ ...draft, title: value.slice(0, 120) });
          }}
        />
        <s-text>Swap products</s-text>
        {draft.swapProducts.map((product) => (
          <s-grid key={product.productId} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-text>{catalog.find((item) => item.id === product.productId)?.title ?? product.productId}</s-text>
            <s-button variant="tertiary" tone="critical" onClick={() => setDraft({ ...draft, swapProducts: draft.swapProducts.filter((item) => item.productId !== product.productId) })}>Remove</s-button>
          </s-grid>
        ))}
        <s-button onClick={() => void addSwaps("product")}>{draft.swapProducts.length > 0 ? "Select more products" : "Add swap products"}</s-button>
        <s-text>Swap collections</s-text>
        {draft.swapCollectionIds.map((id) => (
          <s-grid key={id} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-text>{pages.find((page) => page.collectionId === id)?.title ?? id}</s-text>
            <s-button variant="tertiary" tone="critical" onClick={() => setDraft({ ...draft, swapCollectionIds: draft.swapCollectionIds.filter((item) => item !== id) })}>Remove</s-button>
          </s-grid>
        ))}
        <s-button onClick={() => void addSwaps("collection")}>{draft.swapCollectionIds.length > 0 ? "Select more collections" : "Add swap collections"}</s-button>
        {pickerMessage ? <s-text>{pickerMessage}</s-text> : null}
        {error ? <s-text>{error}</s-text> : null}
        <s-button slot="primary-action" variant="primary" onClick={commit}>Done</s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={modalId}
          command="--hide"
          onClick={() => {
            setDraft(slot);
            setError("");
            setPickerMessage("");
          }}
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}

export function MixSwapDialog({
  modalId,
  heading,
  slot,
  catalog,
  pages,
  priceBook,
  titles,
  onChoose,
}: {
  modalId: string;
  heading: string;
  slot: MixSlot;
  catalog: PreviewProduct[];
  pages: CollectionPage[];
  priceBook: JsonPriceBook | null;
  titles: Record<string, string>;
  onChoose: (variantId: string) => void;
}) {
  const choices = swapChoices(slot, catalog, pages, priceBook, titles);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const incomplete = pages.some((page) => slot.swapCollectionIds.includes(page.collectionId) && (page.hasNextPage || page.products.some((product) => !product.variantsComplete)));

  function choose(choice: SwapChoice) {
    const variantId = variants[choice.productId] ?? choice.variantId;
    const variant = choice.variants.find((item) => item.id === variantId);
    if (!variant?.available) return;
    onChoose(variantId);
    const modal = document.getElementById(modalId) as { hide?: () => void } | null;
    modal?.hide?.();
  }

  return (
    <s-modal id={modalId} heading={heading || "Select product"} size="base">
      {choices.map((choice) => {
        const imageUrl = choice.imageUrl ?? undefined;
        const selected = variants[choice.productId] ?? choice.variantId;
        const available = choice.variants.some((variant) => variant.available);
        return (
          <s-grid key={choice.productId} gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
            {imageUrl ? <s-thumbnail src={imageUrl} alt={choice.imageAlt || "Product"} size="small" /> : <s-icon type="product" />}
            <div>
              <s-text>{choice.source === "original" ? "Original product" : choice.title}</s-text>
              {choice.source === "original" ? <s-text>{choice.title}</s-text> : null}
              <s-text>{choice.variants.find((variant) => variant.id === selected)?.price ?? "Price unavailable"}</s-text>
              {choice.variants.filter((variant) => variant.available).length > 1 ? (
                <s-select
                  label="Variant"
                  name={`${modalId}-${choice.productId}-variant`}
                  value={selected}
                  onChange={(event) => {
                    const value = (event.currentTarget as { value?: string }).value;
                    if (typeof value === "string" && value) setVariants({ ...variants, [choice.productId]: value });
                  }}
                >
                  {choice.variants.filter((variant) => variant.available).map((variant) => (
                    <s-option key={variant.id} value={variant.id}>{variant.title}</s-option>
                  ))}
                </s-select>
              ) : null}
            </div>
            <s-button {...(available ? {} : { disabled: true })} onClick={() => choose(choice)}>Choose</s-button>
          </s-grid>
        );
      })}
      {incomplete ? <s-text>Shopify did not return every product or variant in this collection.</s-text> : null}
      <s-button slot="secondary-actions" variant="secondary" commandFor={modalId} command="--hide">Cancel</s-button>
    </s-modal>
  );
}

function toggleVariant(slot: MixSlot, variantId: string, allowed: boolean): MixSlot {
  const ids = allowed
    ? [...slot.product.allowedVariantIds, variantId].filter((id, index, list) => list.indexOf(id) === index)
    : slot.product.allowedVariantIds.filter((id) => id !== variantId);
  if (ids.length === 0) return slot;
  const selectedVariantId = ids.includes(slot.product.selectedVariantId) ? slot.product.selectedVariantId : ids[0] ?? slot.product.selectedVariantId;
  return { ...slot, product: { ...slot.product, allowedVariantIds: ids, selectedVariantId } };
}

function resourceFromSelection(selection: VariantSelection): PickerResource {
  return {
    id: selection.productId,
    title: selection.productId,
    variants: selection.allowedVariantIds.map((id) => ({ id, title: id })),
  };
}
