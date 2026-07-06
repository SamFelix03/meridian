import { NavLink } from "react-router-dom";
import { cn } from "../../lib/utils";

export interface PortalTab {
  to: string;
  label: string;
  matchPrefix?: boolean;
}

interface PortalTabBarProps {
  tabs: PortalTab[];
  ariaLabel: string;
}

export function PortalTabBar({ tabs, ariaLabel }: PortalTabBarProps) {
  return (
    <nav className="tab-pill-bar w-fit" aria-label={ariaLabel}>
      {tabs.map(({ to, label, matchPrefix }) => (
        <NavLink
          key={to}
          to={to}
          end={!matchPrefix}
          className={({ isActive }) => cn("tab-pill-btn", isActive && "active")}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
