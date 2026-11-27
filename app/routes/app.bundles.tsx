import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { bundleStorageMissing, createDraftForShop, listOffersForView } from "../bundles/editor.server";
import { BundleDeals } from "../components/bundle-deals";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";
import { authenticate } from "../shopify.server";
export { headers };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await loadMerchantView(request);
  const listed = await listOffersForView(merchant.shopDomain);
  return { merchant, ...listed };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "create") return { ok: false };
  try {
    const created = await createDraftForShop(session.shop);
    if (!created.ok) return { ok: false, message: "The offer could not be created." };
    return redirect(`/app/bundles/${created.offerId}`);
  } catch (error) {
    if (bundleStorageMissing(error)) return { ok: false, message: "Bundle storage is not ready." };
    throw error;
  }
};

export default function BundlesPage() {
  const { merchant, offers, storageReady } = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Bundles & Offers"
      summary="Draft and publish bundle configuration. Publishing does not activate the storefront or COD Form."
      merchant={merchant}
    >
      <BundleDeals
        storageReady={storageReady}
        offers={offers.map((offer) => ({
          id: offer.id,
          name: offer.name,
          status: offer.status,
          updatedAt: offer.updatedAt.toISOString(),
        }))}
      />
    </ModulePage>
  );
}
