import { useLocation } from "react-router-dom";
import { Logo } from "../Logo";
import { roleFromPath } from "../../lib/roles";
import { PortalTabBar } from "../ui/PortalTabBar";
import { RoleSwitcher } from "./RoleSwitcher";

const SUPPLIER_TABS = [
  { to: "/supplier/portal", label: "Portal" },
  { to: "/supplier/financing", label: "Financing" },
] as const;

const FINANCIER_TABS = [
  { to: "/financier", label: "Desk" },
  { to: "/financier/syndication", label: "Syndication", matchPrefix: true },
] as const;

export function AppNavbar() {
  const { pathname } = useLocation();
  const role = roleFromPath(pathname);
  const isLanding = pathname === "/";

  return (
    <header className="shrink-0 bg-transparent pt-5 md:pt-6">
      <div className="flex h-[72px] w-full items-center justify-between bg-transparent px-[var(--page-gutter)] transition-all duration-300">
        <div className="flex min-w-0 items-center">
          {!isLanding ? <Logo to="/" size="header" /> : <span className="block h-11 md:h-12" aria-hidden />}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {!isLanding ? <RoleSwitcher /> : null}

          {role === "supplier" ? (
            <PortalTabBar tabs={[...SUPPLIER_TABS]} ariaLabel="Supplier portal" />
          ) : null}
          {role === "financier" ? (
            <PortalTabBar tabs={[...FINANCIER_TABS]} ariaLabel="Financier portal" />
          ) : null}
        </div>
      </div>
    </header>
  );
}
