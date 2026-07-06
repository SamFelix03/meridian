import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export function usePageTab<T extends string>(
  validTabs: readonly T[],
  defaultTab: T,
  paramName = "tab"
): readonly [T, (tab: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const raw = searchParams.get(paramName);
    if (raw && (validTabs as readonly string[]).includes(raw)) {
      return raw as T;
    }
    return defaultTab;
  }, [searchParams, paramName, validTabs, defaultTab]);

  const setTab = useCallback(
    (tab: T) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === defaultTab) next.delete(paramName);
          else next.set(paramName, tab);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, paramName, defaultTab]
  );

  return [activeTab, setTab] as const;
}
