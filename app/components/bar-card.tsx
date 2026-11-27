import { useState } from "react";
import { BAR_MENU } from "../bundles/editor-state";
import { primaryPricing, pricingKind, withBarPricing, type SharedPricing } from "../bundles/bar-edit";
import {
  readSoldOutPresentation,
  soldOutEnabled,
  withSoldOutState,
  writeSoldOutPresentation,
  type SoldOutPresentation,
} from "../bundles/sold-out";
import type { BundleBar } from "../bundles/schema";
import type { CollectionPage, JsonPriceBook, PreviewProduct } from "../bundles/editor-state";
import { AlternativeProductFields } from "./alternative-product";
import { BarImageActions } from "./bar-images";
import { MixSlots } from "./mix-slots";
import { PricingFields } from "./pricing-fields";
import { ProductRows } from "./product-row-editor";
import { TextVariableInsert } from "./text-variable-insert";

export function BarCard({
  bar,
  index,
  count,
  currencyCode,
  catalog,
  catalogSettled,
  priceBook,
  collectionPages = [],
  compareAtNote,
  open,
  onToggle,
  onChange,
  onLoadImages,
  fileUrls,
  onFileReady,
  onDuplicate,
  onDelete,
  onMove,
  onDragStart,
  onDrop,
}: {
  bar: BundleBar;
  index: number;
  count: number;
  currencyCode: string | null;
  catalog: PreviewProduct[];
  catalogSettled: boolean;
  priceBook: JsonPriceBook | null;
  collectionPages?: CollectionPage[];
  compareAtNote: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  onChange: (bar: BundleBar) => void;
  onLoadImages: (productId: string, cursor: string | null) => void;
  fileUrls?: Readonly<Record<string, string | null>>;
  onFileReady?: (fileId: string, url: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (to: number) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const typeLabel = BAR_MENU.find((item) => item.type === bar.type)?.label ?? bar.type;
  const menuId = `bar-actions-${bar.id}`;
  const presentation = readSoldOutPresentation(bar.extensions);
  const enabled = soldOutEnabled(bar);
  const [label, setLabel] = useState(presentation.label);

  function text(field: "title" | "subtitle" | "label" | "textTemplate", value: string, max: number) {
    onChange({ ...bar, [field]: value.slice(0, max) });
  }

  function insert(field: "title" | "subtitle" | "label" | "textTemplate", max: number, token: string) {
    const next = `${bar[field]}${bar[field] ? " " : ""}${token}`.slice(0, max);
    text(field, next, max);
  }

  function pricing(next: SharedPricing, target: "primary" | "get" = "primary") {
    onChange(withBarPricing(bar, next, target));
  }

  function soldOut(nextEnabled: boolean, restrictSelection: boolean, nextPresentation: SoldOutPresentation) {
    const updated = withSoldOutState(bar, nextEnabled, restrictSelection);
    onChange({ ...updated, extensions: writeSoldOutPresentation(updated.extensions, nextPresentation) });
  }

  return (
    <article className="cod-editor-bar" data-bar-id={bar.id} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="cod-editor-bar-head">
        <button
          type="button"
          className="cod-bar-handle"
          draggable
          aria-label={`Reorder ${bar.title || typeLabel}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onDragStart={onDragStart}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onMove(index - 1);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onMove(index + 1);
            }
          }}
        >
          <s-icon type="drag-handle" />
        </button>
        <button type="button" className="cod-bar-toggle" aria-expanded={open} onClick={() => onToggle(!open)}>
          <span>{bar.title || typeLabel}</span>
          <s-text>{typeLabel}</s-text>
        </button>
        <s-button icon="menu-vertical" variant="tertiary" accessibilityLabel={`${typeLabel} actions`} commandFor={menuId} />
        <s-menu id={menuId} accessibilityLabel={`${typeLabel} actions`}>
          <s-button variant="tertiary" commandFor={menuId} command="--hide" {...(index === 0 ? { disabled: true } : {})} onClick={() => onMove(index - 1)}>Move up</s-button>
          <s-button variant="tertiary" commandFor={menuId} command="--hide" {...(index === count - 1 ? { disabled: true } : {})} onClick={() => onMove(index + 1)}>Move down</s-button>
          <s-button variant="tertiary" icon="duplicate" commandFor={menuId} command="--hide" onClick={onDuplicate}>Duplicate</s-button>
          <s-button variant="tertiary" icon="delete" tone="critical" commandFor={menuId} command="--hide" onClick={onDelete}>Delete</s-button>
        </s-menu>
      </div>
      {open ? (
        <div className="cod-editor-section-body">
          <Field label="Title" name={`${bar.id}-title`} value={bar.title} onChange={(value) => text("title", value, 120)} onInsert={(token) => insert("title", 120, token)} />
          <Field label="Subtitle" name={`${bar.id}-subtitle`} value={bar.subtitle} onChange={(value) => text("subtitle", value, 180)} onInsert={(token) => insert("subtitle", 180, token)} />
          <Field label="Label" name={`${bar.id}-label`} value={bar.label} onChange={(value) => text("label", value, 80)} onInsert={(token) => insert("label", 80, token)} />
          <Field label="Text" name={`${bar.id}-text`} value={bar.textTemplate} onChange={(value) => text("textTemplate", value, 300)} onInsert={(token) => insert("textTemplate", 300, token)} />
          {bar.type === "quantity_break" ? (
            <>
              <s-number-field
                label="Quantity"
                name={`${bar.id}-quantity`}
                value={String(bar.config.quantity)}
                min={1}
                max={999}
                step={1}
                onChange={(event) => {
                  const value = numberValue(event);
                  if (value == null || value < 1 || value > 999) return;
                  onChange({ ...bar, config: { ...bar.config, quantity: value } });
                }}
              />
              <s-checkbox
                label="Show quantity selector"
                name={`${bar.id}-selector`}
                {...(bar.config.quantitySelector ? { checked: true } : {})}
                onChange={(event) => {
                  const checked = (event.currentTarget as { checked?: boolean }).checked === true;
                  onChange({ ...bar, config: { ...bar.config, quantitySelector: checked } });
                }}
              />
            </>
          ) : null}
          <s-checkbox
            label="Selected by default"
            name={`${bar.id}-default`}
            {...(bar.selectedByDefault ? { checked: true } : {})}
            onChange={(event) => {
              const checked = (event.currentTarget as { checked?: boolean }).checked === true;
              onChange({ ...bar, selectedByDefault: checked });
            }}
          />
          <BarImageActions
            bar={bar}
            catalog={catalog}
            catalogSettled={catalogSettled}
            onChange={onChange}
            onLoadImages={onLoadImages}
            fileUrls={fileUrls}
            onFileReady={onFileReady}
          />
          {bar.type === "buy_x_get_y" ? (
            <s-number-field
              label="Buy quantity"
              name={`${bar.id}-buy-quantity`}
              value={String(bar.config.buyQuantity)}
              min={1}
              max={999}
              step={1}
              onChange={(event) => {
                const value = numberValue(event);
                if (value == null || value < 1 || value > 999) return;
                onChange({ ...bar, config: { ...bar.config, buyQuantity: value } });
              }}
            />
          ) : null}
          {bar.type === "alternative_product" ? <AlternativeProductFields bar={bar} catalog={catalog} onChange={onChange} /> : null}
          {bar.type === "product_bundle" ? null : <PricingFields label={bar.type === "buy_x_get_y" ? "Buy price" : "Price"} kind={pricingKind(bar)} pricing={primaryPricing(bar)} currencyCode={currencyCode} onChange={(next) => pricing(next)} />}
          {bar.type === "quantity_break" || bar.type === "buy_x_get_y" || bar.type === "alternative_product" ? <s-text>{compareAtNote}</s-text> : null}
          {bar.type === "buy_x_get_y" ? (
            <>
              <s-number-field
                label="Get quantity"
                name={`${bar.id}-get-quantity`}
                value={String(bar.config.getQuantity)}
                min={1}
                max={999}
                step={1}
                onChange={(event) => {
                  const value = numberValue(event);
                  if (value == null || value < 1 || value > 999) return;
                  onChange({ ...bar, config: { ...bar.config, getQuantity: value } });
                }}
              />
              <PricingFields label="Get price" kind="get" pricing={bar.config.getPricing} currencyCode={currencyCode} onChange={(next) => pricing(next, "get")} />
              <s-text>Get items belong to this offer. A 100% discount or a zero fixed price makes them free. Promotional gifts stay separate.</s-text>
            </>
          ) : null}
          {bar.type === "product_bundle" ? (
            <ProductRows bar={bar} currencyCode={currencyCode} catalog={catalog} priceBook={priceBook} onChange={onChange} />
          ) : null}
          {bar.type === "mix_and_match" ? (
            <MixSlots bar={bar} catalog={catalog} pages={collectionPages} onChange={onChange} />
          ) : null}
          <div className="cod-sold-out">
            <s-checkbox
              label="Show as sold out"
              name={`${bar.id}-sold-out`}
              {...(enabled ? { checked: true } : {})}
              onChange={(event) => {
                const checked = (event.currentTarget as { checked?: boolean }).checked === true;
                soldOut(checked, true, presentation);
              }}
            />
            {enabled ? (
              <>
                <s-checkbox
                  label="Prevent selection"
                  name={`${bar.id}-sold-out-lock`}
                  {...(bar.soldOut.restrictSelection ? { checked: true } : {})}
                  onChange={(event) => {
                    const checked = (event.currentTarget as { checked?: boolean }).checked === true;
                    soldOut(true, checked, presentation);
                  }}
                />
                <s-text-field label="Sold-out label" name={`${bar.id}-sold-label`} value={label} onInput={(event) => {
                  const value = (event.currentTarget as { value?: string }).value;
                  if (typeof value !== "string") return;
                  setLabel(value);
                  soldOut(true, bar.soldOut.restrictSelection, { ...presentation, label: value.slice(0, 40) });
                }} />
                <s-number-field label="Opacity" name={`${bar.id}-opacity`} value={String(presentation.opacity)} min={0} max={100} step={1} onChange={(event) => {
                  const value = numberValue(event);
                  if (value == null) return;
                  soldOut(true, bar.soldOut.restrictSelection, { ...presentation, opacity: value });
                }} />
                <s-color-field label="Background color" name={`${bar.id}-sold-bg`} value={presentation.backgroundColor} onChange={(event) => {
                  const value = (event.currentTarget as { value?: string }).value;
                  if (typeof value === "string") soldOut(true, bar.soldOut.restrictSelection, { ...presentation, backgroundColor: value });
                }} />
                <s-color-field label="Text color" name={`${bar.id}-sold-text`} value={presentation.textColor} onChange={(event) => {
                  const value = (event.currentTarget as { value?: string }).value;
                  if (typeof value === "string") soldOut(true, bar.soldOut.restrictSelection, { ...presentation, textColor: value });
                }} />
                <s-number-field label="Font size" name={`${bar.id}-sold-size`} value={String(presentation.fontSize)} min={10} max={32} step={1} onChange={(event) => {
                  const value = numberValue(event);
                  if (value == null) return;
                  soldOut(true, bar.soldOut.restrictSelection, { ...presentation, fontSize: value });
                }} />
              </>
            ) : null}
            <s-text>Upsell, gift, personalisation, and highlights are added in a later stage.</s-text>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  onInsert,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onInsert: (token: string) => void;
}) {
  return (
    <div className="cod-text-field">
      <s-text-field label={label} name={name} value={value} onInput={(event) => {
        const next = (event.currentTarget as { value?: string }).value;
        if (typeof next === "string") onChange(next);
      }} />
      <TextVariableInsert field={name} onInsert={onInsert} />
    </div>
  );
}

function numberValue(event: { currentTarget: EventTarget }) {
  const value = (event.currentTarget as { value?: string }).value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}
