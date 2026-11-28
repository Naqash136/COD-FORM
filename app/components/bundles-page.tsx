import type { ReactNode } from "react";
import type { MerchantView } from "../dashboard/merchant.server";
import { BundleDeals } from "./bundle-deals";
import { ModulePage } from "./module-page";

export function BundlesPageView({
  merchant,
  offers,
  storageReady,
  offerId,
  editor,
}: {
  merchant: MerchantView;
  offers: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  storageReady: boolean;
  offerId?: string;
  editor: ReactNode;
}) {
  if (offerId) return editor;

  return (
    <ModulePage
      heading="Bundles & Offers"
      summary="Draft and publish bundle configuration. Publishing does not activate the storefront or COD Form."
      merchant={merchant}
    >
      <BundleDeals offers={offers} storageReady={storageReady} />
    </ModulePage>
  );
}
