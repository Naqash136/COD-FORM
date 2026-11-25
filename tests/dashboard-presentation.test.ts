import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const presentation = await vite.ssrLoadModule("/app/dashboard/presentation.ts");
const navigation = await vite.ssrLoadModule("/app/dashboard/navigation.ts");

assert.equal(presentation.isDevelopmentPlan("Development"), true);
assert.equal(presentation.isDevelopmentPlan("Developer Preview"), true);
assert.equal(presentation.isDevelopmentPlan("Basic"), false);
assert.equal(presentation.isDevelopmentPlan(null), false);

assert.equal(presentation.parseDateRange("24h"), "24h");
assert.equal(presentation.parseDateRange("all"), "all");
assert.equal(presentation.parseDateRange("year"), "7d");
assert.equal(presentation.parseDateRange(null), "7d");

assert.equal(presentation.parseDealTab("scheduled"), "scheduled");
assert.equal(presentation.parseDealTab("archived"), "all");

assert.equal(
  presentation.currencyNote("PKR"),
  "Amounts will use PKR when tracking is available.",
);
assert.equal(
  presentation.currencyNote("USD"),
  "Amounts will use USD when tracking is available.",
);
assert.equal(
  presentation.currencyNote("  "),
  "Store currency is not available yet.",
);
assert.equal(presentation.UNAVAILABLE, "—");

const hrefs = navigation.appNavigation.map(
  (item: { href: string }) => item.href,
);
assert.equal(new Set(hrefs).size, hrefs.length);
assert.ok(hrefs.every((href: string) => href.startsWith("/app")));
assert.equal(hrefs[0], "/app");

await vite.close();
console.log(JSON.stringify({ ok: true, routes: hrefs.length }));
