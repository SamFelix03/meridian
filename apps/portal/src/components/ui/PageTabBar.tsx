import { cn } from "../../lib/utils";

export interface PageTabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface PageTabBarProps<T extends string> {
  tabs: PageTabItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  ariaLabel?: string;
}

export function PageTabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel = "Page sections",
}: PageTabBarProps<T>) {
  return (
    <nav className="mb-6 flex justify-center" aria-label={ariaLabel}>
      <div className="tab-pill-bar max-w-full overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn("tab-pill-btn", activeTab === tab.id && "active")}
            onClick={() => onTabChange(tab.id)}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            {tab.label}
            {tab.count != null ? (
              <span className="ml-1 opacity-80">({tab.count})</span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
