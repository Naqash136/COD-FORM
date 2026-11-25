import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { DEAL_TABS, parseDealTab } from "../dashboard/presentation";
import { UnavailableButton } from "./metric-card";

export function BundleDeals({ currencyNote }: { currencyNote: string }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const tab = parseDealTab(params.get("deals"));
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const selected = DEAL_TABS.find((item) => item.id === tab) ?? DEAL_TABS[0];

  return (
    <s-section heading="Bundle deals">
      <s-stack direction="block" gap="base">
        <div className="cod-toolbar">
          <UnavailableButton label="Create bundle deal" icon="plus" variant="primary" />
          <UnavailableButton label="Brand colors" icon="paint-brush-flat" />
          <UnavailableButton label="Performance" icon="chart-vertical" />
          <s-text color="subdued">Not available yet. {currencyNote}</s-text>
        </div>

        <div className="cod-toolbar">
          <s-button-group accessibilityLabel="Bundle deal status" gap="base">
            {DEAL_TABS.map((item) => {
              const next = new URLSearchParams(params);
              next.set("deals", item.id);
              return (
                <s-button
                  key={item.id}
                  variant={item.id === tab ? "primary" : "secondary"}
                  href={`${location.pathname}?${next.toString()}`}
                >
                  {item.label}
                </s-button>
              );
            })}
          </s-button-group>
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
      </s-stack>
    </s-section>
  );
}
