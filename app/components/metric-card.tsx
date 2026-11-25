import type { ReactNode } from "react";
import { UNAVAILABLE } from "../dashboard/presentation";

const METRIC_ICONS = {
  "Total revenue": "cash-dollar",
  "Total orders": "order",
  "Added revenue": "chart-vertical",
  "Average order value": "calculator",
  "Orders with bundles (%)": "product",
  "Revenue per visitor": "person",
  "COD orders": "delivery",
  "Prepaid orders": "credit-card",
  "COD converted to prepaid": "exchange",
  "Partial payments collected": "cash-dollar",
  "OTP verified orders": "check-circle",
  "COD fees collected": "receipt",
  "COD form orders": "forms",
  "Bundle deals": "product",
  Upsells: "chart-popular",
  "Free gift orders": "gift-card",
  "Abandoned cart recovery": "cart",
  Delivered: "delivery",
  "In transit": "airplane",
  "Returned (RTO)": "return",
  Cancelled: "x-circle",
  "Successful SMS": "chat",
  "Successful WhatsApp": "chat",
  "Abandoned cart reminders": "notification",
  "Verification pending": "clock",
  "Verification failed": "alert-circle",
} as const;

type MetricIcon = (typeof METRIC_ICONS)[keyof typeof METRIC_ICONS] | "view";

export function MetricIconBadge({ type }: { type: MetricIcon }) {
  return (
    <span className="cod-icon" aria-hidden="true">
      <s-icon type={type} size="small" />
    </span>
  );
}

export function MetricCard({ label }: { label: string }) {
  const icon = METRIC_ICONS[label as keyof typeof METRIC_ICONS] ?? "chart-popular";

  return (
    <article className="cod-card">
      <div className="cod-card-top">
        <MetricIconBadge type={icon} />
        <p className="cod-metric-label">{label}</p>
      </div>
      <p className="cod-metric-value" title="Not tracked">
        {UNAVAILABLE}
      </p>
    </article>
  );
}

export function MetricGrid({ labels }: { labels: readonly string[] }) {
  return (
    <div className="cod-metrics">
      {labels.map((label) => (
        <MetricCard key={label} label={label} />
      ))}
    </div>
  );
}

export function SectionBlock({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="cod-section">
      <div className="cod-section-head">
        <h2 className="cod-section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function UnavailableButton({
  label,
  icon,
  variant = "secondary",
  slot,
}: {
  label: string;
  icon?: "plus" | "paint-brush-flat" | "chart-vertical" | "settings";
  variant?: "primary" | "secondary" | "tertiary";
  slot?: "primary-action" | "secondary-actions";
}) {
  return (
    <s-button
      slot={slot}
      variant={variant}
      icon={icon}
      disabled
      accessibilityLabel={`${label}. Not available yet.`}
    >
      {label}
    </s-button>
  );
}
