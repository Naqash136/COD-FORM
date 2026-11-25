import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { UnavailableButton } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function PlansPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Plans & Billing"
      summary="COD FORM plans and billing are not configured. No charge is created from this page."
      merchant={merchant}
    >
      <s-section heading="Current plan">
        <s-stack direction="block" gap="base">
          <s-text>
            Shopify plan: {merchant.plan ?? "Not available"}
          </s-text>
          <s-badge tone="info">Not configured</s-badge>
          <UnavailableButton label="Choose a plan" variant="primary" />
          <s-text color="subdued">Not available yet.</s-text>
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
