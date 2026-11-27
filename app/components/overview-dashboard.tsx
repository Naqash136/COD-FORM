import { Form } from "react-router";
import type { MerchantView } from "../dashboard/merchant.server";
import {
  DELIVERY_OUTCOMES,
  FEATURE_REVENUE,
  MESSAGE_METRICS,
  PAYMENT_METRICS,
  SALES_METRICS,
  currencyNote,
} from "../dashboard/presentation";
import { BundleDeals } from "./bundle-deals";
import { DateRangeFilters } from "./date-range-filters";
import { DevelopmentNotice } from "./module-page";
import { MetricGrid, MetricIconBadge, SectionBlock } from "./metric-card";

export function OverviewDashboard({
  merchant,
  offers,
  storageReady,
}: {
  merchant: MerchantView;
  offers: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  storageReady: boolean;
}) {
  return (
    <s-page inlineSize="large">
      <Form method="post" action="/app/bundles" slot="primary-action">
        <input type="hidden" name="intent" value="create" />
        <s-button type="submit" variant="primary" icon="plus" {...(storageReady ? {} : { disabled: true })}>
          Create bundle deal
        </s-button>
      </Form>
      <div className="cod-dashboard">
        <header className="cod-header">
          <div className="cod-header-top">
            <div>
              <h1 className="cod-page-title">Overview</h1>
              <p className="cod-store-name">{merchant.shopName}</p>
            </div>
            <div className="cod-widget">
              <MetricIconBadge type="view" />
              <div className="cod-widget-copy">
                <span>Store widget</span>
                <s-badge tone="warning">Not configured</s-badge>
              </div>
            </div>
          </div>
          <DevelopmentNotice merchant={merchant} />
          <DateRangeFilters analyticsHref="/app/analytics" />
          <p className="cod-note">{currencyNote(merchant.currency)}</p>
        </header>

        <SectionBlock title="Sales performance">
          <MetricGrid labels={SALES_METRICS} />
        </SectionBlock>

        <SectionBlock title="COD & payment performance">
          <MetricGrid labels={PAYMENT_METRICS} />
        </SectionBlock>

        <BundleDeals offers={offers} storageReady={storageReady} />

        <SectionBlock title="Revenue by feature">
          <MetricGrid labels={FEATURE_REVENUE} />
        </SectionBlock>

        <SectionBlock title="Delivery outcomes">
          <MetricGrid labels={DELIVERY_OUTCOMES} />
        </SectionBlock>

        <SectionBlock title="Message summary">
          <MetricGrid labels={MESSAGE_METRICS} />
        </SectionBlock>
      </div>
    </s-page>
  );
}
