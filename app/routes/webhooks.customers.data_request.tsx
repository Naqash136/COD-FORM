import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic } = await authenticate.webhook(request);

  if (topic !== "CUSTOMERS_DATA_REQUEST") {
    return new Response(null, { status: 400 });
  }

  // COD FORM does not store Shopify customer records. Nothing is returned or retained.
  return new Response();
};
