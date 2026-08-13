import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  return (
    <div className="layout">
      <Sidebar />
      <main id="content">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<div>Overview page</div>} />
          <Route path="/sessions" element={<div>Sessions page</div>} />
          <Route path="/correlation" element={<div>Correlation page</div>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}
