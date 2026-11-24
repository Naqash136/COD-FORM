import type { ActionFunctionArgs } from "react-router";
import { markShopUninstalled } from "../models/merchant.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic !== "APP_UNINSTALLED") {
    return new Response(null, { status: 400 });
  }

  console.log(`Received ${topic} webhook for ${shop}`);
  await markShopUninstalled(shop);

  return new Response();
};
