import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MetricGrid, UnavailableButton } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import { PAYMENT_METRICS } from "../dashboard/presentation";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function PaymentsPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="COD & Payments"
      summary="Cash-on-delivery fees, partial payments, and prepaid conversion are not configured."
      merchant={merchant}
    >
      <s-section heading="Payment performance">
        <s-stack direction="block" gap="base">
          <MetricGrid labels={PAYMENT_METRICS} detail="Not tracked" />
          <UnavailableButton label="Configure payments" icon="settings" variant="primary" />
          <s-text color="subdued">Not available yet.</s-text>
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
