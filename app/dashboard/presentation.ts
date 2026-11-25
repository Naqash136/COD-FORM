export const UNAVAILABLE = "—";

export const DATE_RANGES = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
] as const;

export type DateRangeId = (typeof DATE_RANGES)[number]["id"];

export const DEAL_TABS = [
  { id: "all", label: "All deals" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "scheduled", label: "Scheduled" },
] as const;

export type DealTabId = (typeof DEAL_TABS)[number]["id"];

export const SALES_METRICS = [
  "Total revenue",
  "Total orders",
  "Added revenue",
  "Average order value",
  "Orders with bundles (%)",
  "Revenue per visitor",
] as const;

export const PAYMENT_METRICS = [
  "COD orders",
  "Prepaid orders",
  "COD converted to prepaid",
  "Partial payments collected",
  "OTP verified orders",
  "COD fees collected",
] as const;

export const FEATURE_REVENUE = [
  "COD form orders",
  "Bundle deals",
  "Upsells",
  "Free gift orders",
  "Abandoned cart recovery",
] as const;

export const DELIVERY_OUTCOMES = [
  "Delivered",
  "In transit",
  "Returned (RTO)",
  "Cancelled",
] as const;

export const MESSAGE_METRICS = [
  "Successful SMS",
  "Successful WhatsApp",
  "Abandoned cart reminders",
] as const;

const DATE_RANGE_IDS = new Set<string>(DATE_RANGES.map((range) => range.id));
const DEAL_TAB_IDS = new Set<string>(DEAL_TABS.map((tab) => tab.id));

export function isDevelopmentPlan(plan: string | null | undefined) {
  if (!plan) return false;
  return /development|developer preview/i.test(plan);
}

export function parseDateRange(value: string | null | undefined): DateRangeId {
  if (value && DATE_RANGE_IDS.has(value)) return value as DateRangeId;
  return "7d";
}

export function dateRangeLabel(id: DateRangeId) {
  return DATE_RANGES.find((range) => range.id === id)?.label ?? "7 days";
}

export function parseDealTab(value: string | null | undefined): DealTabId {
  if (value && DEAL_TAB_IDS.has(value)) return value as DealTabId;
  return "all";
}

export function currencyNote(currency: string | null | undefined) {
  const code = currency?.trim();
  if (!code) return "Store currency is not available yet.";
  return `Amounts will use ${code} when tracking is available.`;
}
