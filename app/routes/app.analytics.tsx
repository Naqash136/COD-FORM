import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DateRangeFilters } from "../components/date-range-filters";
import { MetricGrid } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import {
  DELIVERY_OUTCOMES,
  FEATURE_REVENUE,
  PAYMENT_METRICS,
  SALES_METRICS,
} from "../dashboard/presentation";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function AnalyticsPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Analytics"
      summary="Charts and historical analytics are not available until order tracking is implemented. No sample data is shown."
      merchant={merchant}
    >
      <s-section heading="Performance">
        <s-stack direction="block" gap="base">
          <DateRangeFilters />
          <s-banner heading="Charts are not available" tone="info">
            <s-text>
              COD FORM does not have tracked orders or visits to chart yet.
            </s-text>
          </s-banner>
          <MetricGrid labels={SALES_METRICS} detail="Not tracked" />
          <MetricGrid labels={PAYMENT_METRICS} detail="Not tracked" />
          <MetricGrid labels={FEATURE_REVENUE} detail="Not tracked" />
          <MetricGrid labels={DELIVERY_OUTCOMES} detail="Not tracked" />
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
