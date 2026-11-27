import { readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom", logLevel: "error" });
const editor = await vite.ssrLoadModule("/app/bundles/editor-state.ts");
const view = await vite.ssrLoadModule("/app/components/bundle-editor.tsx");
const card = await vite.ssrLoadModule("/app/components/bar-card.tsx");
const sold = await vite.ssrLoadModule("/app/bundles/sold-out.ts");

const product = {
  id: "gid://shopify/Product/1",
  title: "Loaded product",
  status: "ACTIVE",
  featuredImageUrl: null,
  featuredImageAlt: null,
  variantsComplete: true,
  variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default", availableForSale: true, regularLabel: null, compareLabel: null }],
};
const quantity = editor.createBar("quantity_break", product, "barqty1");
const bundle = editor.createBar("buy_x_get_y", product, "barbxgy1");
const locked = sold.withSoldOutState({ ...bundle.bar, title: "Gift {{quantity}}" }, true, true);
const soldBar = {
  ...locked,
  extensions: sold.writeSoldOutPresentation(locked.extensions, sold.DEFAULT_SOLD_OUT_PRESENTATION),
};
const document = {
  ...editor.emptyDocument("Weekend offer"),
  bars: [
    { ...quantity.bar, selectedByDefault: true, title: "Buy {{quantity}}", subtitle: "Save {{saved_amount}}", label: "Best value" },
    soldBar,
  ],
};
const offer = {
  offerId: "offer-1",
  status: "DRAFT",
  document,
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
};
const router = createMemoryRouter([
  { path: "/app/bundles/:offerId", element: createElement(view.BundleEditor, { offer }) },
], { initialEntries: ["/app/bundles/offer-1"] });
const editorHtml = renderToString(createElement(RouterProvider, { router }));
const openCard = renderToString(createElement(card.BarCard, {
  bar: document.bars[1],
  index: 0,
  count: 2,
  currencyCode: "USD",
  open: true,
  onToggle: () => {},
  onChange: () => {},
  onDuplicate: () => {},
  onDelete: () => {},
  onMove: () => {},
  onDragStart: () => {},
  onDrop: () => {},
}));
const book = {
  currencyCode: "USD",
  variants: {
    "gid://shopify/ProductVariant/1": {
      available: true,
      regular: { amountMinor: "1799", currencyCode: "USD", exponent: 2 },
      compareAt: { amountMinor: "2499", currencyCode: "USD", exponent: 2 },
    },
  },
};
const cards = editor.previewBarCards(document, book, { "gid://shopify/Product/1": "Loaded product" });
const preview = cards.map((item) => `<div class="${item.barId === "barqty1" ? "cod-offer is-selected" : "cod-offer"}${item.soldOut ? " is-sold-out" : ""}" role="radio" aria-checked="${item.barId === "barqty1"}" aria-disabled="${!item.selectable}" style="${item.presentation ? `opacity:${item.presentation.opacity / 100};background:${item.presentation.backgroundColor};color:${item.presentation.textColor};font-size:${item.presentation.fontSize}px` : ""}"><strong>${item.soldOut ? item.presentation.label : ""}</strong><s-text>${item.label}</s-text><strong>${item.title}</strong><s-text>${item.subtitle}</s-text><s-text>${item.price.ok ? `${item.price.final} ${item.price.currency}` : item.price.message}</s-text><s-text>${item.price.ok && item.price.compareAt ? `Compare at ${item.price.compareAt}` : ""}</s-text><s-text>${item.price.ok ? `Save ${item.price.savings} ${item.price.currency} (${item.price.savedPercentage})` : ""}</s-text></div>`).join("");
const css = readFileSync(new URL("../app/styles/cod-form.css", import.meta.url), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://cdn.shopify.com/shopifycloud/polaris-2.js"></script><style>${css}</style></head><body><main class="cod-editor-page">${editorHtml}<section><h2>Expanded shared controls</h2>${openCard}</section><section class="cod-editor-offers" role="radiogroup">${preview}</section></main></body></html>`;
writeFileSync(new URL("./stage5.html", import.meta.url), html);
await vite.close();
console.log("wrote stage5.html");
