import type { BundleBar, JsonValue } from "./schema";

export const SOLD_OUT_EXTENSION_KEY = "soldOutPresentation";

export type SoldOutPresentation = {
  label: string;
  opacity: number;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
};

export const DEFAULT_SOLD_OUT_PRESENTATION: SoldOutPresentation = {
  label: "Sold out",
  opacity: 55,
  backgroundColor: "#f6f6f7",
  textColor: "#616161",
  fontSize: 14,
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function readSoldOutPresentation(extensions: BundleBar["extensions"]): SoldOutPresentation {
  const raw = extensions?.[SOLD_OUT_EXTENSION_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SOLD_OUT_PRESENTATION };
  const record = raw as Record<string, JsonValue>;
  return {
    label: typeof record.label === "string" && record.label.trim() ? record.label.slice(0, 40) : DEFAULT_SOLD_OUT_PRESENTATION.label,
    opacity: integerIn(record.opacity, 0, 100, DEFAULT_SOLD_OUT_PRESENTATION.opacity),
    backgroundColor: typeof record.backgroundColor === "string" && HEX.test(record.backgroundColor) ? record.backgroundColor : DEFAULT_SOLD_OUT_PRESENTATION.backgroundColor,
    textColor: typeof record.textColor === "string" && HEX.test(record.textColor) ? record.textColor : DEFAULT_SOLD_OUT_PRESENTATION.textColor,
    fontSize: integerIn(record.fontSize, 10, 32, DEFAULT_SOLD_OUT_PRESENTATION.fontSize),
  };
}

export function writeSoldOutPresentation(extensions: BundleBar["extensions"], presentation: SoldOutPresentation): BundleBar["extensions"] {
  return {
    ...(extensions ?? {}),
    [SOLD_OUT_EXTENSION_KEY]: {
      label: presentation.label.slice(0, 40),
      opacity: presentation.opacity,
      backgroundColor: presentation.backgroundColor,
      textColor: presentation.textColor,
      fontSize: presentation.fontSize,
    },
  };
}

export function soldOutEnabled(bar: Pick<BundleBar, "soldOut">) {
  return bar.soldOut.appearance !== "hide";
}

export function barSelectable(bar: Pick<BundleBar, "soldOut">) {
  return !(bar.soldOut.appearance === "show_unavailable" && bar.soldOut.restrictSelection);
}

export function withSoldOutState(bar: BundleBar, enabled: boolean, restrictSelection: boolean): BundleBar {
  const appearance = !enabled ? "hide" : restrictSelection ? "show_unavailable" : "show_selectable";
  return {
    ...bar,
    soldOut: {
      appearance,
      restrictSelection: enabled ? restrictSelection : true,
    },
  };
}

function integerIn(value: JsonValue | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}
