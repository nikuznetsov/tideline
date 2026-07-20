import { useQuery } from "@tanstack/react-query";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { api, setWorkspaceSlug } from "./api/client";

export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string;
  role: string;
  default_member_role: string;
}

interface WorkspaceContextValue {
  current: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  /** может редактировать данные пространства */
  canEdit: boolean;
  /** владелец: участники, инвайты, share-ссылки, настройки */
  isOwner: boolean;
  wsPath: (path: string) => string;
}

export const WorkspaceCtx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace вне WorkspaceShell");
  return ctx;
}

/** Как useWorkspace, но безопасно вне пространства (публичные страницы). */
export function useWorkspaceMaybe(): WorkspaceContextValue | null {
  return useContext(WorkspaceCtx);
}

export function useMyWorkspaces() {
  return useQuery<WorkspaceInfo[]>({
    queryKey: ["workspaces"],
    queryFn: () => api.get<WorkspaceInfo[]>("/workspaces"),
  });
}

export const LAST_WS_KEY = "tideline:last-workspace";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  // слаг должен быть выставлен до первого рендера детей — иначе их запросы уйдут мимо
  setWorkspaceSlug(slug ?? "");
  const workspaces = useMyWorkspaces();

  useEffect(() => {
    if (slug) localStorage.setItem(LAST_WS_KEY, slug);
  }, [slug]);

  if (workspaces.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Загрузка…
      </div>
    );
  }
  const list = workspaces.data ?? [];
  const current = list.find((w) => w.slug === slug);
  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="font-wide text-lg font-bold">Нет доступа</div>
        <p className="max-w-sm text-sm text-muted">
          Пространство «{slug}» не найдено среди ваших. Попросите ссылку-приглашение
          у владельца или выберите другое пространство.
        </p>
        <Link to="/workspaces" className="rounded bg-ink px-4 py-2 text-sm font-medium text-surface">
          Мои пространства
        </Link>
      </div>
    );
  }

  const value: WorkspaceContextValue = {
    current,
    workspaces: list,
    canEdit: current.role === "owner" || current.role === "editor",
    isOwner: current.role === "owner",
    wsPath: (path: string) => `/w/${current.slug}${path}`,
  };
  // key={slug}: при смене пространства дерево перемонтируется — локальный
  // стейт страниц не переживает переключение
  return (
    <WorkspaceCtx.Provider key={current.slug} value={value}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
