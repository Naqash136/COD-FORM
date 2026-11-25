import { UNAVAILABLE } from "../dashboard/presentation";

export function MetricCard({
  label,
  detail = "Not tracked",
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className="cod-card">
      <s-box padding="base">
        <s-stack direction="block" gap="small">
          <s-text color="subdued">{label}</s-text>
          <p className="cod-metric-value">{UNAVAILABLE}</p>
          <s-text color="subdued">{detail}</s-text>
        </s-stack>
      </s-box>
    </div>
  );
}

export function MetricGrid({
  labels,
  detail,
}: {
  labels: readonly string[];
  detail?: string;
}) {
  return (
    <div className="cod-metrics">
      {labels.map((label) => (
        <MetricCard key={label} label={label} detail={detail} />
      ))}
    </div>
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
