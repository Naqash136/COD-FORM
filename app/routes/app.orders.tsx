import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ModulePage } from "../components/module-page";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";
import { currencyNote } from "../dashboard/presentation";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function OrdersPage() {
  const merchant = useLoaderData<typeof loader>();

  return (
    <ModulePage
      heading="Orders"
      summary="COD FORM is not tracking orders yet. This table stays empty until order tracking is implemented."
      merchant={merchant}
    >
      <s-section heading="Orders">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">{currencyNote(merchant.currency)}</s-text>
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header listSlot="labeled">Payment</s-table-header>
              <s-table-header listSlot="labeled">Verification</s-table-header>
              <s-table-header listSlot="labeled">Delivery</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                Total
              </s-table-header>
            </s-table-header-row>
            <s-table-body />
          </s-table>
          <s-empty-state heading="No orders yet">
            <s-icon slot="graphic" type="order" />
            <s-text slot="subheading">
              Orders placed through COD FORM will appear here. None have been
              recorded.
            </s-text>
          </s-empty-state>
        </s-stack>
      </s-section>
    </ModulePage>
  );
}
