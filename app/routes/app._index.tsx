import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { listOffersForView } from "../bundles/editor.server";
import { OverviewDashboard } from "../components/overview-dashboard";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await loadMerchantView(request);
  const listed = await listOffersForView(merchant.shopDomain);
  return {
    merchant,
    storageReady: listed.storageReady,
    offers: listed.offers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      status: offer.status,
      updatedAt: offer.updatedAt.toISOString(),
    })),
  };
};

export default function Overview() {
  const { merchant, offers, storageReady } = useLoaderData<typeof loader>();
  return <OverviewDashboard merchant={merchant} offers={offers} storageReady={storageReady} />;
}
