import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { bundleStorageMissing, createDraftForShop, listOffersForView } from "../bundles/editor.server";
import { BundlesPageView } from "../components/bundles-page";
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
  const { offerId } = useParams();

  return (
    <BundlesPageView
      merchant={merchant}
      storageReady={storageReady}
      offerId={offerId}
      editor={<Outlet />}
      offers={offers.map((offer) => ({
        id: offer.id,
        name: offer.name,
        status: offer.status,
        updatedAt: offer.updatedAt.toISOString(),
      }))}
    />
  );
}
