import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function SupportPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Help & Support"
      summary="In-app support requests are not available yet. This page does not open a ticket."
      merchant={merchant}
    >
      <s-section heading="Resources">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Shopify’s help center is available if you need help with the admin
            itself.
          </s-paragraph>
          <s-link href="https://help.shopify.com" target="_blank">
            Shopify Help Center
          </s-link>
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
