import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type {} from "@shopify/app-bridge-types";

import { appNavigation } from "../dashboard/navigation";
import { registerAuthenticatedMerchant } from "../models/merchant.server";
import { authenticate } from "../shopify.server";
import "../styles/cod-form.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await registerAuthenticatedMerchant({ session, admin, reason: "access" });

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        {appNavigation.map((item) => (
          <s-link key={item.href} href={item.href}>
            {item.label}
          </s-link>
        ))}
      </s-app-nav>
      <div className="cod-app">
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
