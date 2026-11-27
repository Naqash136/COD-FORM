import { useState } from "react";
import {
  applyPickerResult,
  removePickerResource,
  selectionRule,
  type PickerResource,
  type SelectionCardinality,
  type SelectionPurpose,
} from "../bundles/shopify/selection";

export type ResourcePickerKind = "product" | "variant" | "collection";

export type ResourcePickerOptions = {
  type: ResourcePickerKind;
  action?: "select" | "add";
  multiple?: boolean | number;
  selectionIds?: Array<{ id: string; variants?: Array<{ id: string }> }>;
  filter?: { query?: string };
};

export type ResourcePicker = (options: ResourcePickerOptions) => Promise<PickerResource[] | undefined>;

export function pickerOptions(
  purpose: SelectionPurpose,
  resource: ResourcePickerKind,
  current: PickerResource[],
): ResourcePickerOptions {
  const rule = selectionRule(purpose);
  const cardinality = resource === "product" ? rule.products : resource === "variant" ? rule.variants : rule.collections;
  return {
    type: resource,
    action: "select",
    multiple: cardinality === "multiple" ? true : false,
    selectionIds: current.map((item) => ({
      id: item.id,
      variants: item.variants.map((variant) => ({ id: variant.id })),
    })),
  };
}

export async function openResourcePicker(
  picker: ResourcePicker,
  options: ResourcePickerOptions,
  current: PickerResource[],
  cardinality: SelectionCardinality,
) {
  const picked = await picker(options);
  return applyPickerResult(current, picked, cardinality);
}

export function ShopifyResourceField({
  label,
  purpose,
  resource,
  selection,
  onChange,
  picker = defaultResourcePicker,
}: {
  label: string;
  purpose: SelectionPurpose;
  resource: ResourcePickerKind;
  selection: PickerResource[];
  onChange: (selection: PickerResource[]) => void;
  picker?: ResourcePicker;
}) {
  const [message, setMessage] = useState("");
  const rule = selectionRule(purpose);
  const cardinality = resource === "product" ? rule.products : resource === "variant" ? rule.variants : rule.collections;

  async function choose() {
    const result = await openResourcePicker(picker, pickerOptions(purpose, resource, selection), selection, cardinality);
    if (!result.ok) {
      setMessage(result.code === "too_many" ? "Only one resource can be selected." : "This resource cannot be selected here.");
      return;
    }
    if (result.cancelled) {
      setMessage("");
      return;
    }
    setMessage("");
    onChange(result.selection);
  }

  return (
    <div>
      <s-button onClick={() => void choose()}>{label}</s-button>
      <ul>
        {selection.map((item) => (
          <li key={item.id}>
            <span>{item.title}</span>
            <s-button
              variant="tertiary"
              onClick={() => onChange(removePickerResource(selection, item.id))}
            >
              Remove
            </s-button>
          </li>
        ))}
      </ul>
      {message ? <s-text>{message}</s-text> : null}
    </div>
  );
}

export function adminResourcePicker(options: ResourcePickerOptions) {
  const shopify = (globalThis as { shopify?: { resourcePicker?: ResourcePicker } }).shopify;
  if (!shopify?.resourcePicker) return Promise.resolve(undefined);
  return shopify.resourcePicker(options);
}

function defaultResourcePicker(options: ResourcePickerOptions) {
  return adminResourcePicker(options);
}
