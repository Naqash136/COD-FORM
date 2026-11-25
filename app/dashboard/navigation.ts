export const appNavigation = [
  { href: "/app", label: "Overview" },
  { href: "/app/bundles", label: "Bundles & Offers" },
  { href: "/app/cod-form", label: "COD Form" },
  { href: "/app/orders", label: "Orders" },
  { href: "/app/order-verification", label: "Order Verification" },
  { href: "/app/payments", label: "COD & Payments" },
  { href: "/app/messages", label: "SMS & WhatsApp" },
  { href: "/app/analytics", label: "Analytics" },
  { href: "/app/integrations", label: "Integrations" },
  { href: "/app/settings", label: "Settings" },
  { href: "/app/plans", label: "Plans & Billing" },
  { href: "/app/support", label: "Help & Support" },
] as const;

export type AppNavigationItem = (typeof appNavigation)[number];
