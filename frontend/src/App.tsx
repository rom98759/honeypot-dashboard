import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { OverviewPage } from "./pages/OverviewPage";
import { SessionsPage } from "./pages/SessionsPage/SessionsPage";
import { CorrelationPage } from "./pages/CorrelationPage";
import { MapPage } from "./pages/MapPage";
import { IpDetailPage } from "./pages/IpDetailPage";

export default function App() {
  return (
    <div className="layout">
      <Sidebar />
      <main id="content">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/correlation" element={<CorrelationPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/ip/:ip" element={<IpDetailPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}
