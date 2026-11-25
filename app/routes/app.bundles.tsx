import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { BundleDeals } from "../components/bundle-deals";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";
export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function BundlesPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Bundles & Offers"
      summary="Bundle deals, offers, and brand colors are not available yet. This page does not create or activate a deal."
      merchant={merchant}
    >
      <BundleDeals />
    </ModulePage>
  );
}
