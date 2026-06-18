import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { OverviewPage } from "./pages/OverviewPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { ExecutionDetailPage } from "./pages/ExecutionDetailPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SchedulePage } from "./pages/SchedulePage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { UsagePage } from "./pages/UsagePage";
import { RealTimeTranslatorPage } from "./pages/RealTimeTranslatorPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/executions" element={<ExecutionsPage />} />
        <Route path="/executions/:id" element={<ExecutionDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/shortcuts" element={<ShortcutsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/translator" element={<RealTimeTranslatorPage />} />
      </Routes>
    </AppShell>
  );
}
