import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MetricGrid } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function OrderVerificationPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Order Verification"
      summary="OTP and order verification are not configured. No verification messages are being sent."
      merchant={merchant}
    >
      <s-section heading="Verification">
        <MetricGrid
          labels={["OTP verified orders", "Verification pending", "Verification failed"]}
          detail="Not configured"
        />
      </s-section>
    </ModulePage>
  );
}
