import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DateRangeFilters } from "../components/date-range-filters";
import { MetricGrid, SectionBlock } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import {
  DELIVERY_OUTCOMES,
  FEATURE_REVENUE,
  PAYMENT_METRICS,
  SALES_METRICS,
  currencyNote,
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
      <SectionBlock title="Performance">
        <DateRangeFilters />
        <p className="cod-note">{currencyNote(merchant.currency)}</p>
        <s-banner heading="Charts are not available" tone="info">
          <s-text>
            COD FORM does not have tracked orders or visits to chart yet.
          </s-text>
        </s-banner>
        <MetricGrid labels={SALES_METRICS} />
        <MetricGrid labels={PAYMENT_METRICS} />
        <MetricGrid labels={FEATURE_REVENUE} />
        <MetricGrid labels={DELIVERY_OUTCOMES} />
      </SectionBlock>
    </ModulePage>
  );
}
