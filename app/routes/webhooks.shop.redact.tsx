import type { ActionFunctionArgs } from "react-router";
import { redactShop } from "../models/merchant.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic !== "SHOP_REDACT") {
    return new Response(null, { status: 400 });
  }

  await redactShop(shop);
  return new Response();
};
