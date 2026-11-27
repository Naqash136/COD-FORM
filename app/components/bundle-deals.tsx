import { useState } from "react";
import { Form, useLocation, useSearchParams } from "react-router";
import { DEAL_TABS, parseDealTab, UNAVAILABLE } from "../dashboard/presentation";
import { UnavailableButton } from "./metric-card";

export function BundleDeals({
  offers,
  storageReady,
}: {
  offers: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  storageReady: boolean;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const tab = parseDealTab(params.get("deals"));
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const selected = DEAL_TABS.find((item) => item.id === tab) ?? DEAL_TABS[0];
  const visible = offers.filter((offer) => {
    const matchesQuery = !trimmedQuery || offer.name.toLowerCase().includes(trimmedQuery.toLowerCase());
    const matchesTab = tab === "all" || (tab === "inactive" && offer.status === "INACTIVE");
    return matchesQuery && matchesTab;
  });

  return (
    <section className="cod-panel" aria-labelledby="bundle-deals-heading">
      <div className="cod-panel-head">
        <h2 className="cod-section-title" id="bundle-deals-heading">
          Bundle deals
        </h2>
        <div className="cod-actions">
          <Form method="post" action="/app/bundles">
            <input type="hidden" name="intent" value="create" />
            <s-button type="submit" variant="primary" icon="plus" {...(storageReady ? {} : { disabled: true })}>
              Create bundle deal
            </s-button>
          </Form>
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

      {!storageReady ? (
        <s-banner heading="Bundle storage is not ready" tone="warning">
          <s-text>The bundle tables are not on this database. Creating an offer needs the approved migration first.</s-text>
        </s-banner>
      ) : null}
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
        <s-table-body>
          {visible.map((offer) => (
            <s-table-row key={offer.id}>
              <s-table-cell>
                <s-link href={`/app/bundles/${offer.id}`}>{offer.name}</s-link>
              </s-table-cell>
              <s-table-cell>{offer.status}</s-table-cell>
              <s-table-cell>{UNAVAILABLE}</s-table-cell>
              <s-table-cell>{UNAVAILABLE}</s-table-cell>
              <s-table-cell>{UNAVAILABLE}</s-table-cell>
              <s-table-cell>{UNAVAILABLE}</s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>

      {visible.length === 0 ? (
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
              ? `Nothing in ${selected.label.toLowerCase()} matches “${trimmedQuery}”.`
              : tab === "active"
                ? "Published configuration stays off the storefront and COD Form."
                : tab === "scheduled"
                  ? "Scheduling is not part of this offer yet."
                  : "Create a bundle deal to start a draft. Publishing a configuration does not activate it."}
          </s-text>
          <Form slot="primary-action" method="post" action="/app/bundles">
            <input type="hidden" name="intent" value="create" />
            <s-button type="submit" variant="primary" {...(storageReady ? {} : { disabled: true })}>
              Create bundle deal
            </s-button>
          </Form>
        </s-empty-state>
      ) : null}
    </section>
  );
}
