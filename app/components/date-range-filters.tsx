import { useLocation, useSearchParams } from "react-router";
import {
  DATE_RANGES,
  dateRangeLabel,
  parseDateRange,
} from "../dashboard/presentation";

export function DateRangeFilters({
  analyticsHref,
}: {
  analyticsHref?: string;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const selected = parseDateRange(params.get("range"));

  return (
    <div className="cod-toolbar">
      <s-button-group accessibilityLabel="Date range" gap="base">
        {DATE_RANGES.map((range) => {
          const next = new URLSearchParams(params);
          next.set("range", range.id);
          return (
            <s-button
              key={range.id}
              variant={selected === range.id ? "primary" : "secondary"}
              href={`${location.pathname}?${next.toString()}`}
            >
              {range.label}
            </s-button>
          );
        })}
      </s-button-group>
      {analyticsHref ? (
        <s-link href={analyticsHref}>View full analytics</s-link>
      ) : null}
      <s-text color="subdued">
        Showing {dateRangeLabel(selected)}. Tracking is not available yet.
      </s-text>
    </div>
  );
}
