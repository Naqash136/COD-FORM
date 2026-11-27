import { useState } from "react";
import { currencyExponent } from "../bundles/currencies";
import { formatDecimal } from "../bundles/money";
import {
  basisPointsFromPercent,
  emptyPricing,
  percentFromBasisPoints,
  storedAmount,
  type SharedPricing,
} from "../bundles/bar-edit";

export function PricingFields({
  label,
  kind,
  pricing,
  currencyCode,
  onChange,
}: {
  label: string;
  kind: "group" | "get" | "deal";
  pricing: SharedPricing;
  currencyCode: string | null;
  onChange: (pricing: SharedPricing) => void;
}) {
  const [percent, setPercent] = useState(pricing.mode === "percentage_off" ? percentFromBasisPoints(pricing.basisPoints) : "0");
  const [amount, setAmount] = useState(pricing.mode === "amount_off" || pricing.mode === "fixed_price" ? formatStored(pricing.amount.amountMinor, pricing.amount.currencyCode) : "");
  const [error, setError] = useState("");
  const modes = kind === "get"
    ? [["percentage_off", "Percentage off"], ["amount_off", "Amount off"], ["fixed_price", "Fixed price"]]
    : [["full_price", "Regular price"], ["percentage_off", "Percentage off"], ["amount_off", "Amount off"], ["fixed_price", "Fixed price"]];

  function changeMode(mode: string) {
    if (mode !== "full_price" && mode !== "percentage_off" && mode !== "amount_off" && mode !== "fixed_price") return;
    if ((mode === "amount_off" || mode === "fixed_price") && !currencyCode) {
      setError("Choose a product with a Shopify price before entering an amount.");
      return;
    }
    const next = emptyPricing(kind, mode, currencyCode ?? "USD");
    if (!next) return;
    setError("");
    if (next.mode === "percentage_off") setPercent("0");
    if (next.mode === "amount_off" || next.mode === "fixed_price") setAmount("0");
    onChange(next);
  }

  return (
    <div className="cod-pricing-fields">
      <s-select label={label} name={`${label}-mode`} value={pricing.mode} onChange={(event) => {
        const value = (event.currentTarget as { value?: string }).value;
        if (typeof value === "string") changeMode(value);
      }}>
        {modes.map(([value, text]) => <s-option key={value} value={value}>{text}</s-option>)}
      </s-select>
      <s-text>{scopeCopy(kind, pricing.mode)}</s-text>
      {pricing.mode === "percentage_off" ? (
        <s-text-field
          label="Percentage"
          name={`${label}-percent`}
          value={percent}
          onInput={(event) => {
            const value = (event.currentTarget as { value?: string }).value;
            if (typeof value !== "string") return;
            setPercent(value);
            const basisPoints = basisPointsFromPercent(value);
            if (basisPoints == null) {
              setError("Enter a percentage from 0 to 100.");
              return;
            }
            setError("");
            onChange({ ...pricing, basisPoints });
          }}
        />
      ) : null}
      {pricing.mode === "amount_off" || pricing.mode === "fixed_price" ? (
        <s-text-field
          label={pricing.mode === "fixed_price" ? "Fixed price" : "Amount off"}
          name={`${label}-amount`}
          value={amount}
          {...(currencyCode ? {} : { disabled: true })}
          onInput={(event) => {
            const value = (event.currentTarget as { value?: string }).value;
            if (typeof value !== "string" || !currencyCode) return;
            setAmount(value);
            const stored = storedAmount(value, currencyCode);
            if (!stored) {
              setError(`Enter an amount in ${currencyCode}.`);
              return;
            }
            setError("");
            onChange({ ...pricing, amount: stored });
          }}
        />
      ) : null}
      {error ? <s-text>{error}</s-text> : null}
    </div>
  );
}

function scopeCopy(kind: "group" | "get" | "deal", mode: SharedPricing["mode"]) {
  if (mode === "full_price") return kind === "get" ? "Get items need a discount." : "Customers pay the regular product price.";
  if (kind === "deal" && mode === "percentage_off") return "Percentage off the whole bundle.";
  if (kind === "deal" && mode === "amount_off") return "Amount off the whole bundle once.";
  if (kind === "deal") return "Fixed total for the whole bundle.";
  if (mode === "percentage_off") return kind === "get" ? "Percentage off the get items." : "Percentage off the line.";
  if (mode === "amount_off") return kind === "get" ? "Amount off each get item." : "Amount off each item.";
  return kind === "get" ? "Fixed total for the get quantity." : "Fixed total for this quantity.";
}

function formatStored(amountMinor: string, currencyCode: string) {
  const exponent = currencyExponent(currencyCode) ?? 2;
  return formatDecimal({ amountMinor: BigInt(amountMinor), currencyCode, exponent });
}
