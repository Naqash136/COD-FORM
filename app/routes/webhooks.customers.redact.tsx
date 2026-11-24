import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic } = await authenticate.webhook(request);

  if (topic !== "CUSTOMERS_REDACT") {
    return new Response(null, { status: 400 });
  }

  // COD FORM does not store Shopify customer records, so there is nothing to delete.
  return new Response();
};
