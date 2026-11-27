import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { bundleStorageMissing, editableDocument, loadOfferForShop, publishDraftForShop, saveDraftForShop } from "../bundles/editor.server";
import { BundleEditor, type EditorLoaderData } from "../components/bundle-editor";
import { newMediaFileIds, verifyChangedImages } from "../bundles/images";
import { readMerchantFile } from "../bundles/shopify/files.server";
import type { NormalizedProduct } from "../bundles/shopify/catalog";
import type { AdminGraphql } from "../bundles/shopify/admin";
import { loadProductImages, loadProductsForMerchant } from "../bundles/shopify/products.server";
import { validateDocument } from "../bundles/validate";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { headers } from "../dashboard/headers";

export { headers };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  let offer: Awaited<ReturnType<typeof loadOfferForShop>>;
  try {
    offer = await loadOfferForShop(session.shop, params.offerId ?? "");
  } catch (error) {
    if (bundleStorageMissing(error)) throw new Response("Bundle storage is not ready", { status: 503 });
    throw error;
  }
  const document = offer ? editableDocument(offer) : null;
  if (!offer || !document) {
    throw new Response("Offer not found", { status: 404 });
  }
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, select: { countryCode: true } });
  const data: EditorLoaderData = {
    offerId: offer.id,
    status: offer.status,
    document,
    draftRevisionId: offer.draftRevisionId,
    publishedRevisionId: offer.publishedRevisionId,
    storefrontActive: offer.storefrontActive,
    codFormActive: offer.codFormActive,
    countryCode: shop?.countryCode ?? null,
  };
  return data;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") === "publish" ? "publish" : "save";
  const expected = String(form.get("expectedDraftRevisionId") ?? "");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(String(form.get("document") ?? ""));
  } catch {
    return { ok: false, intent, message: "The offer could not be read." };
  }
  const validated = validateDocument(parsed, "draft");
  if (!validated.ok) return { ok: false, intent, code: "invalid", message: validated.errors[0]?.message ?? "The offer is incomplete." };
  const productIds = [...new Set(collectProductIds(validated.document))];
  const loaded = productIds.length === 0 ? null : await loadProductsForMerchant(admin, {
    sessionShop: session.shop,
    productIds,
    requestToken: "save",
    scopes: String(session.scope ?? "").split(",").filter(Boolean),
  });
  if (loaded && !loaded.ok) return { ok: false, intent, message: "Shopify could not confirm the selected products." };
  const products = loaded?.ok ? loaded.catalog.products : [];
  if (loaded?.ok) await completeProductImages(admin, session.shop, products);
  const existing = await loadOfferForShop(session.shop, params.offerId ?? "");
  const previous = existing?.draft?.valid ? existing.draft.document : existing?.published?.valid ? existing.published.document : null;
  const readableFileIds: string[] = [];
  for (const fileId of newMediaFileIds(previous, validated.document)) {
    const resolved = await readMerchantFile(admin, session.shop, fileId);
    const accessible = (resolved.ok && resolved.code === "ready") || (!resolved.ok && resolved.code === "processing");
    if (accessible) readableFileIds.push(fileId);
  }
  const imageAccess = {
    allowFixtureImages: process.env.COD_FORM_ALLOW_FIXTURE_IMAGES === "1",
    readableFileIds,
  };
  const imageCheck = verifyChangedImages(previous, validated.document, products, imageAccess);
  if (!imageCheck.ok) return { ok: false, intent, code: "invalid", message: imageCheck.message };
  const result = intent === "publish"
    ? await publishDraftForShop(session.shop, params.offerId ?? "", validated.document, expected || null, products, undefined, imageAccess)
    : await saveDraftForShop(session.shop, params.offerId ?? "", validated.document, expected || null, products, undefined, imageAccess);
  if (!result.ok) {
    const message = "message" in result && result.message
      ? result.message
      : "errors" in result ? result.errors?.[0]?.message : undefined;
    return {
      ok: false,
      intent,
      code: result.code,
      message,
      revisionId: "revisionId" in result ? result.revisionId : undefined,
      document: "document" in result ? result.document : undefined,
    };
  }
  return {
    ok: true,
    intent,
    revisionId: result.revisionId,
    status: result.status,
    document: validated.document,
  };
}

export default function BundleEditorRoute() {
  const offer = useLoaderData<typeof loader>();
  return <BundleEditor offer={offer} />;
}

async function completeProductImages(admin: AdminGraphql, shop: string, products: NormalizedProduct[]) {
  for (const product of products) {
    let cursor = product.imagesCursor;
    let pages = 0;
    while (product.imagesComplete === false && cursor && pages < 5) {
      const page = await loadProductImages(admin, { sessionShop: shop, productId: product.id, cursor, requestToken: "save-images" });
      if (!page.ok || page.unavailable) {
        product.imagesComplete = true;
        break;
      }
      for (const image of page.images) {
        if (!product.images.some((item) => item.url === image.url)) product.images.push(image);
      }
      product.imagesComplete = !page.hasNextPage;
      product.imagesCursor = page.endCursor;
      cursor = page.endCursor;
      pages += 1;
    }
  }
}

function collectProductIds(document: { products: { items: Array<{ product: { productId: string } }> }; bars: unknown[] }) {
  const ids = document.products.items.map((item) => item.product.productId);
  const text = JSON.stringify(document.bars);
  const matches = text.match(/gid:\/\/shopify\/Product\/\d+/g) ?? [];
  return [...ids, ...matches];
}
