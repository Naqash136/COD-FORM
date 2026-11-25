import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { UnavailableButton } from "../components/metric-card";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

const SETTINGS = [
  "Store widget",
  "Brand colors",
  "COD form",
  "Payment rules",
  "Messaging",
] as const;

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function SettingsPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Settings"
      summary="Store settings are not editable yet. Nothing on this page is saved."
      merchant={merchant}
    >
      <s-section heading="Configuration">
        <s-stack direction="block" gap="base">
          {SETTINGS.map((name) => (
            <s-stack key={name} direction="inline" gap="base" alignItems="center">
              <s-text>{name}</s-text>
              <s-badge tone="warning">Not configured</s-badge>
            </s-stack>
          ))}
          <UnavailableButton label="Save settings" variant="primary" />
          <s-text color="subdued">Not available yet.</s-text>
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
