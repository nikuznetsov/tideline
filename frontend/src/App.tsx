import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { api, ApiError } from "./api/client";
import type { User } from "./api/types";
import { Layout } from "./components/Layout";
import { AccuracyPage } from "./pages/AccuracyPage";
import { JoinPage } from "./pages/JoinPage";
import { LandingPage } from "./pages/LandingPage";
import { ProjectCardPage } from "./pages/ProjectCardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SharePage } from "./pages/SharePage";
import { TeamPage } from "./pages/TeamPage";
import { TimelinePage } from "./pages/TimelinePage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { LAST_WS_KEY, useMyWorkspaces, WorkspaceShell } from "./workspace";

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

  const authed = !!user && !(error instanceof ApiError);

  if (!authed) {
    return (
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/join/:token" element={<JoinPage user={null} />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/register" element={<HomeRedirect />} />
      <Route path="/workspaces" element={<WorkspacesPage user={user!} />} />
      <Route path="/join/:token" element={<JoinPage user={user!} />} />
      <Route
        path="/w/:slug/*"
        element={
          <WorkspaceShell>
            <Layout user={user!}>
              <Routes>
                <Route path="/" element={<TimelinePage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectCardPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/accuracy" element={<AccuracyPage />} />
                <Route path="/participants" element={<Navigate to="../team" replace />} />
                <Route path="*" element={<Navigate to="." replace />} />
              </Routes>
            </Layout>
          </WorkspaceShell>
        }
      />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

/** После входа: next из URL → последнее пространство → первое → список. */
function HomeRedirect() {
  const [params] = useSearchParams();
  const workspaces = useMyWorkspaces();
  const next = params.get("next");
  if (next && next.startsWith("/")) return <Navigate to={next} replace />;
  if (workspaces.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Загрузка…
      </div>
    );
  }
  const list = workspaces.data ?? [];
  const last = localStorage.getItem(LAST_WS_KEY);
  const target = list.find((w) => w.slug === last) ?? list[0];
  if (target) return <Navigate to={`/w/${target.slug}/`} replace />;
  return <Navigate to="/workspaces" replace />;
}
