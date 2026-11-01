import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { HealthBanner } from "./components/HealthBanner";
import { Sidebar } from "./components/Sidebar";
import { SkeletonBlock } from "./components/SkeletonBlock";
import { ThemeProvider } from "./theme/ThemeContext";
import { PeriodProvider } from "./theme/PeriodContext";

// Per-page chunks: Chart.js and the map library only load on the pages that draw them.
const OverviewPage = lazy(() => import("./pages/OverviewPage").then((m) => ({ default: m.OverviewPage })));
const SessionsPage = lazy(() =>
  import("./pages/SessionsPage/SessionsPage").then((m) => ({ default: m.SessionsPage }))
);
const CommandsPage = lazy(() => import("./pages/CommandsPage").then((m) => ({ default: m.CommandsPage })));
const CorrelationPage = lazy(() =>
  import("./pages/CorrelationPage").then((m) => ({ default: m.CorrelationPage }))
);
const MapPage = lazy(() => import("./pages/MapPage").then((m) => ({ default: m.MapPage })));
const IpDetailPage = lazy(() => import("./pages/IpDetailPage").then((m) => ({ default: m.IpDetailPage })));

export default function App() {
  return (
    <ThemeProvider>
      <PeriodProvider>
        <div className="layout">
          <Sidebar />
          <main id="content">
            <HealthBanner />
            <Suspense fallback={<SkeletonBlock rows={6} />}>
              <Routes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/commands" element={<CommandsPage />} />
                <Route path="/correlation" element={<CorrelationPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/ip/:ip" element={<IpDetailPage />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </PeriodProvider>
    </ThemeProvider>
  );
}
