import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MetricGrid, UnavailableButton } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import { MESSAGE_METRICS } from "../dashboard/presentation";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function MessagesPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="SMS & WhatsApp"
      summary="SMS and WhatsApp messaging are not connected. No reminders are being sent."
      merchant={merchant}
    >
      <s-section heading="Message summary">
        <s-stack direction="block" gap="base">
          <MetricGrid labels={MESSAGE_METRICS} detail="Not configured" />
          <UnavailableButton label="Connect messaging" variant="primary" />
          <s-text color="subdued">Not available yet.</s-text>
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
