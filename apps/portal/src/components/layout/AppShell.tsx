import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppNavbar } from "./AppNavbar";
import { LandingPage } from "../../pages/LandingPage";
import { SupplierPage } from "../../pages/SupplierPage";
import { SupplierFinancingPage } from "../../pages/SupplierFinancingPage";
import { BuyerPage } from "../../pages/BuyerPage";
import { FinancierPage } from "../../pages/FinancierPage";
import { FinancierSyndicationPage } from "../../pages/FinancierSyndicationPage";
import { OpsPage } from "../../pages/OpsPage";

export function AppShell() {
  const { pathname } = useLocation();
  const isLanding = pathname === "/";

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-clip bg-background">
      <AppNavbar />
      <main
        className={
          isLanding
            ? "flex flex-1 flex-col px-[var(--page-gutter)]"
            : "mx-auto flex w-full min-w-0 max-w-[var(--page-max)] flex-1 flex-col overflow-x-clip px-[var(--page-gutter)] py-8"
        }
      >
        <div
          className={
            isLanding
              ? "flex w-full max-w-[var(--page-max)] flex-1 flex-col"
              : "w-full min-w-0 max-w-full overflow-x-clip"
          }
        >
          <Routes>
            <Route path="/" element={<LandingPage />} />

            <Route path="/supplier" element={<Navigate to="/supplier/portal" replace />} />
            <Route path="/supplier/portal" element={<SupplierPage />} />
            <Route path="/supplier/financing" element={<SupplierFinancingPage />} />

            <Route path="/buyer" element={<BuyerPage />} />

            <Route path="/financier" element={<FinancierPage />} />
            <Route path="/financier/syndication" element={<FinancierSyndicationPage />} />

            <Route path="/ops" element={<OpsPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
