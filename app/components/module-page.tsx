import type { ReactNode } from "react";
import type { MerchantView } from "../dashboard/merchant.server";
import { currencyNote } from "../dashboard/presentation";

export function StoreContext({ merchant }: { merchant: MerchantView }) {
  if (!merchant.registered) {
    return (
      <s-banner heading="Store record unavailable" tone="warning">
        <s-text>
          COD FORM could not read an active store record for {merchant.shopDomain}.
        </s-text>
      </s-banner>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      {merchant.developmentStore ? (
        <s-banner heading="Development store" tone="info">
          <s-text>
            {merchant.shopName} ({merchant.shopDomain}) is on the{" "}
            {merchant.plan} plan.
          </s-text>
        </s-banner>
      ) : (
        <s-banner heading={merchant.shopName} tone="info">
          <s-text>
            {merchant.shopDomain}
            {merchant.plan ? ` · ${merchant.plan}` : ""}
          </s-text>
        </s-banner>
      )}
      <s-text color="subdued">{currencyNote(merchant.currency)}</s-text>
    </s-stack>
  );
}

export function ModulePage({
  heading,
  summary,
  merchant,
  children,
}: {
  heading: string;
  summary: string;
  merchant: MerchantView;
  children?: ReactNode;
}) {
  return (
    <s-page heading={heading} inlineSize="large">
      <div className="cod-stack">
        <StoreContext merchant={merchant} />
        <s-section heading="Not configured">
          <s-stack direction="block" gap="base">
            <s-badge tone="info">Not configured</s-badge>
            <s-paragraph>{summary}</s-paragraph>
          </s-stack>
        </s-section>
        {children}
      </div>
    </s-page>
  );
}
