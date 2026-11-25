import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

const INTEGRATIONS = [
  "Shopify checkout",
  "SMS provider",
  "WhatsApp provider",
  "Shipping and delivery",
] as const;

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function IntegrationsPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Integrations"
      summary="No external integrations are connected. Connecting a provider is not available yet."
      merchant={merchant}
    >
      <s-section heading="Connections">
        <s-stack direction="block" gap="base">
          {INTEGRATIONS.map((name) => (
            <s-stack key={name} direction="inline" gap="base" alignItems="center">
              <s-text>{name}</s-text>
              <s-badge tone="warning">Not configured</s-badge>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
