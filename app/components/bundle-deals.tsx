import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { DEAL_TABS, parseDealTab } from "../dashboard/presentation";
import { UnavailableButton } from "./metric-card";

export function BundleDeals() {
  const location = useLocation();
  const [params] = useSearchParams();
  const tab = parseDealTab(params.get("deals"));
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const selected = DEAL_TABS.find((item) => item.id === tab) ?? DEAL_TABS[0];

  return (
    <section className="cod-panel" aria-labelledby="bundle-deals-heading">
      <div className="cod-panel-head">
        <h2 className="cod-section-title" id="bundle-deals-heading">
          Bundle deals
        </h2>
        <div className="cod-actions">
          <UnavailableButton label="Create bundle deal" icon="plus" variant="primary" />
          <UnavailableButton label="Brand colors" icon="paint-brush-flat" />
        </div>
      </div>

      <div className="cod-panel-tools">
        <div className="cod-filters" role="group" aria-label="Bundle deal status">
          {DEAL_TABS.map((item) => {
            const next = new URLSearchParams(params);
            next.set("deals", item.id);
            const active = item.id === tab;
            return (
              <s-button
                key={item.id}
                variant={active ? "primary" : "secondary"}
                href={`${location.pathname}?${next.toString()}`}
                accessibilityLabel={
                  active ? `${item.label}, selected` : item.label
                }
              >
                {item.label}
              </s-button>
            );
          })}
        </div>
        <div className="cod-search">
          <s-search-field
            label="Search deals"
            labelAccessibilityVisibility="exclusive"
            name="deal-search"
            placeholder="Search deals"
            value={query}
            onInput={(event) => {
              const value = (event.currentTarget as { value?: string }).value;
              if (typeof value === "string") setQuery(value);
            }}
          />
        </div>
      </div>

      <s-table variant="auto">
        <s-table-header-row>
          <s-table-header listSlot="primary">Deal</s-table-header>
          <s-table-header listSlot="labeled">Status</s-table-header>
          <s-table-header listSlot="labeled">Schedule</s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Orders
          </s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Revenue
          </s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Added revenue
          </s-table-header>
        </s-table-header-row>
        <s-table-body />
      </s-table>

      <s-empty-state
        heading={
          trimmedQuery
            ? "No deals match this search"
            : tab === "all"
              ? "No bundle deals yet"
              : `No ${selected.label.toLowerCase()} deals`
        }
      >
        <s-icon slot="graphic" type="product" />
        <s-text slot="subheading">
          {trimmedQuery
            ? `Nothing in ${selected.label.toLowerCase()} matches “${trimmedQuery}”. Bundle deals are not configured.`
            : "Bundle deals are not configured. Creating a deal is not available yet."}
        </s-text>
        <s-button slot="primary-action" variant="primary" disabled>
          Create bundle deal
        </s-button>
      </s-empty-state>
    </section>
  );
}
