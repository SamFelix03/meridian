import type { LucideIcon } from "lucide-react";
import { Building2, Landmark, Shield, ShoppingCart } from "lucide-react";

export type MeridianRole = "supplier" | "buyer" | "financier" | "ops";

export interface RoleDefinition {
  id: MeridianRole;
  title: string;
  shortLabel: string;
  description: string;
  homePath: string;
  icon: LucideIcon;
}

export const ROLES: RoleDefinition[] = [
  {
    id: "supplier",
    title: "Enter as Supplier",
    shortLabel: "Supplier",
    description:
      "Issue invoices, manage consent policies, post receivables, and run sealed-bid financing rounds.",
    homePath: "/supplier/portal",
    icon: Building2,
  },
  {
    id: "buyer",
    title: "Enter as Buyer",
    shortLabel: "Buyer",
    description:
      "Co-sign supplier proposals, view obligations, and settle repayments with privacy-preserving buyer view.",
    homePath: "/buyer",
    icon: ShoppingCart,
  },
  {
    id: "financier",
    title: "Enter as Financier",
    shortLabel: "Financier",
    description:
      "Review invitations, submit oracle-anchored bids, manage mandates, and participate in syndication.",
    homePath: "/financier",
    icon: Landmark,
  },
  {
    id: "ops",
    title: "Enter as Platform Ops",
    shortLabel: "Platform Ops",
    description:
      "Monitor settlement finality, oracle health, regulator grants, and KYB / AML onboarding gates.",
    homePath: "/ops",
    icon: Shield,
  },
];

export function roleFromPath(pathname: string): MeridianRole | null {
  if (pathname.startsWith("/supplier")) return "supplier";
  if (pathname.startsWith("/buyer")) return "buyer";
  if (pathname.startsWith("/financier")) return "financier";
  if (pathname.startsWith("/ops")) return "ops";
  return null;
}

export function getRoleDefinition(role: MeridianRole): RoleDefinition {
  return ROLES.find((r) => r.id === role)!;
}
