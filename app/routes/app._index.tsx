import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { OverviewDashboard } from "../components/overview-dashboard";
import { headers } from "../dashboard/headers";
import { loadMerchantView } from "../dashboard/merchant.server";

export { headers };

export const loader = ({ request }: LoaderFunctionArgs) => {
  return loadMerchantView(request);
};

export default function Overview() {
  const merchant = useLoaderData<typeof loader>();
  return <OverviewDashboard merchant={merchant} />;
}
