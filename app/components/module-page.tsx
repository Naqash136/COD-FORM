import type { ReactNode } from "react";
import type { MerchantView } from "../dashboard/merchant.server";

export function DevelopmentNotice({ merchant }: { merchant: MerchantView }) {
  if (!merchant.registered) {
    return (
      <s-banner heading="Store record unavailable" tone="warning">
        <s-text>
          COD FORM could not read an active store record for {merchant.shopDomain}.
        </s-text>
      </s-banner>
    );
  }

  if (!merchant.developmentStore) return null;

  return (
    <div className="cod-dev-banner" role="status">
      <s-icon type="alert-triangle" tone="warning" />
      <div className="cod-dev-copy">
        <strong>Development store</strong>
        <p>
          {merchant.shopName} ({merchant.shopDomain}) is on the {merchant.plan}{" "}
          plan.
        </p>
      </div>
    </div>
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
      <div className="cod-dashboard">
        <DevelopmentNotice merchant={merchant} />
        <section className="cod-panel">
          <div className="cod-inline">
            <h2 className="cod-section-title">Not configured</h2>
            <s-badge tone="info">Not configured</s-badge>
          </div>
          <s-paragraph>{summary}</s-paragraph>
        </section>
        {children}
      </div>
    </s-page>
  );
}
