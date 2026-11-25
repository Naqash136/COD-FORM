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
    <div className="cod-header-filters">
      <div className="cod-filters" role="group" aria-label="Date range">
        {DATE_RANGES.map((range) => {
          const next = new URLSearchParams(params);
          next.set("range", range.id);
          const active = selected === range.id;
          return (
            <s-button
              key={range.id}
              variant={active ? "primary" : "secondary"}
              href={`${location.pathname}?${next.toString()}`}
              accessibilityLabel={
                active ? `${range.label}, selected` : range.label
              }
            >
              {range.label}
            </s-button>
          );
        })}
      </div>
      <div className="cod-actions">
        {analyticsHref ? (
          <s-button variant="tertiary" href={analyticsHref}>
            View full analytics
          </s-button>
        ) : null}
        <p className="cod-note">
          Showing {dateRangeLabel(selected)}. Tracking is not available yet.
        </p>
      </div>
    </div>
  );
}
