import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, ApiError } from "./api/client";
import type { User } from "./api/types";
import { Layout } from "./components/Layout";
import { AccuracyPage } from "./pages/AccuracyPage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectCardPage } from "./pages/ProjectCardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SharePage } from "./pages/SharePage";
import { TeamPage } from "./pages/TeamPage";
import { TimelinePage } from "./pages/TimelinePage";

export default function App() {
  const location = useLocation();
  const isPublic = location.pathname.startsWith("/s/");
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["me"],
    queryFn: () => api.get<User>("/auth/me"),
    retry: false,
    enabled: !isPublic,
  });

  if (isPublic) {
    return (
      <Routes>
        <Route path="/s/:token/*" element={<SharePage />} />
      </Routes>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Загрузка…
      </div>
    );
  }

  const authed = user && !(error instanceof ApiError);

  if (!authed) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Layout user={user!}>
      <Routes>
        <Route path="/" element={<TimelinePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectCardPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/accuracy" element={<AccuracyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
