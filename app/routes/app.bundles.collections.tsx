import type { LoaderFunctionArgs } from "react-router";
import { listCollectionProducts } from "../bundles/shopify/collections.server";
import type { CollectionPage, PreviewProduct } from "../bundles/editor-state";
import { isCollectionGid } from "../bundles/shopify/ids";
import { authenticate } from "../shopify.server";

const PAGE_LIMIT = 20;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestToken = url.searchParams.get("token") ?? "";
  const cursor = url.searchParams.get("cursor");
  const single = url.searchParams.get("collectionId") ?? "";
  const ids = [...new Set((single || url.searchParams.get("collectionIds") || "").split(",").map((id) => id.trim()).filter((id) => isCollectionGid(id)))].slice(0, PAGE_LIMIT);
  if (ids.length === 0) {
    return { requestToken, append: false, pages: [] as CollectionPage[], page: null, message: null };
  }
  const pages: CollectionPage[] = [];
  let message: string | null = null;
  for (const collectionId of cursor ? ids.slice(0, 1) : ids) {
    const loaded = await listCollectionProducts(admin, {
      sessionShop: session.shop,
      collectionId,
      cursor: cursor || null,
      requestToken,
    });
    if (!loaded.ok) {
      message = "Shopify could not load every collection.";
      continue;
    }
    pages.push({
      collectionId: loaded.page.collectionId,
      title: loaded.page.title,
      products: loaded.page.products.map(presentCollectionProduct),
      hasNextPage: loaded.page.hasNextPage,
      endCursor: loaded.page.endCursor,
    });
    if (loaded.page.products.some((product) => !product.variantsComplete)) {
      message = "Shopify did not return every variant for one or more collection products.";
    }
  }
  return {
    requestToken,
    append: Boolean(cursor),
    pages,
    page: pages[0] ?? null,
    message,
  };
}

function presentCollectionProduct(product: {
  id: string;
  title: string;
  status: string;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  variantsComplete: boolean;
  variants: Array<{ id: string; title: string; availableForSale: boolean }>;
}): PreviewProduct {
  const status = product.status === "ACTIVE" || product.status === "DRAFT" || product.status === "ARCHIVED" ? product.status : "UNKNOWN";
  return {
    id: product.id,
    title: product.title,
    status,
    featuredImageUrl: product.featuredImageUrl,
    featuredImageAlt: product.featuredImageAlt,
    variantsComplete: product.variantsComplete,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      availableForSale: variant.availableForSale,
      regularLabel: null,
      compareLabel: null,
    })),
  };
}
