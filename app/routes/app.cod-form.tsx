import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ModulePage } from "../components/module-page";
import { UnavailableButton } from "../components/metric-card";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function CodFormPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="COD Form"
      summary="The cash-on-delivery form builder is not available yet. No form is published to the storefront."
      merchant={merchant}
    >
      <s-section heading="Form status">
        <s-stack direction="block" gap="base">
          <s-badge tone="warning">Not configured</s-badge>
          <s-paragraph>
            Fields, design, and storefront placement will be configured here in a
            later phase.
          </s-paragraph>
          <UnavailableButton label="Publish form" variant="primary" />
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
