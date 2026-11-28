import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true, watch: null },
  appType: "custom",
  logLevel: "error",
});

const view = await vite.ssrLoadModule("/app/components/bundles-page.tsx");
const merchant = {
  registered: true,
  shopName: "Aura",
  shopDomain: "aura-data.myshopify.com",
  currency: "PKR",
  timezone: "Asia/Karachi",
  plan: "Development",
  email: null,
  countryCode: "PK",
  developmentStore: true,
};
const offers = [{
  id: "offer-1",
  name: "Weekend offer",
  status: "DRAFT",
  updatedAt: "2026-11-28T00:00:00.000Z",
}];

function render(offerId?: string) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement(view.BundlesPageView, {
        merchant,
        offers,
        storageReady: true,
        offerId,
        editor: createElement("h1", null, "Editor open"),
      }),
    },
  ], { initialEntries: ["/"] });
  return renderToString(createElement(RouterProvider, { router }));
}

const list = render();
assert.match(list, /Bundle deals/);
assert.match(list, /Create bundle deal/);
assert.match(list, /Weekend offer/);
assert.equal(list.includes("Editor open"), false);

const editor = render("offer-1");
assert.match(editor, /Editor open/);
assert.equal(editor.includes("Create bundle deal"), false);
assert.equal(editor.includes("Weekend offer"), false);

await vite.close();
console.log(JSON.stringify({ ok: true, navigation: "editor-route-renders" }));
