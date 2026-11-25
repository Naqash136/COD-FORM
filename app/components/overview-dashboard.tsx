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
import { MetricGrid, UnavailableButton } from "./metric-card";
import { StoreContext } from "./module-page";

export function OverviewDashboard({ merchant }: { merchant: MerchantView }) {
  const note = currencyNote(merchant.currency);

  return (
    <s-page heading="Overview" inlineSize="large">
      <UnavailableButton
        slot="primary-action"
        label="Create bundle deal"
        icon="plus"
        variant="primary"
      />
      <div className="cod-stack">
        <div className="cod-brand">
          <span className="cod-mark" aria-hidden="true">
            COD
          </span>
          <s-stack direction="block" gap="none">
            <s-heading>COD FORM</s-heading>
            <s-text color="subdued">{merchant.shopName}</s-text>
          </s-stack>
        </div>

        <StoreContext merchant={merchant} />

        <s-section heading="Store widget">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone="warning">Not configured</s-badge>
            <s-text>
              The storefront widget is not set up for {merchant.shopDomain}.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Sales performance">
          <s-stack direction="block" gap="base">
            <DateRangeFilters analyticsHref="/app/analytics" />
            <MetricGrid labels={SALES_METRICS} detail="Not tracked" />
            <s-text color="subdued">{note}</s-text>
          </s-stack>
        </s-section>

        <s-section heading="COD & payment performance">
          <MetricGrid labels={PAYMENT_METRICS} detail="Not tracked" />
        </s-section>

        <BundleDeals currencyNote={note} />

        <s-section heading="Revenue by feature">
          <MetricGrid labels={FEATURE_REVENUE} detail="Not tracked" />
        </s-section>

        <s-section heading="Delivery outcomes">
          <MetricGrid labels={DELIVERY_OUTCOMES} detail="Not tracked" />
        </s-section>

        <s-section heading="Message summary">
          <MetricGrid labels={MESSAGE_METRICS} detail="Not configured" />
        </s-section>
      </div>
    </s-page>
  );
}
