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
  /** may edit workspace data */
  canEdit: boolean;
  /** owner: participants, invites, share links, settings */
  isOwner: boolean;
  wsPath: (path: string) => string;
}

export const WorkspaceCtx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace outside WorkspaceShell");
  return ctx;
}

/** Like useWorkspace, but safe outside a workspace (public pages). */
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
  // the slug must be set before the children first render — otherwise their requests go to the wrong place
  setWorkspaceSlug(slug ?? "");
  const workspaces = useMyWorkspaces();

  useEffect(() => {
    if (slug) localStorage.setItem(LAST_WS_KEY, slug);
  }, [slug]);

  const list = workspaces.data ?? [];
  const current = list.find((w) => w.slug === slug);
  // while the list is loading or refreshing, "no access" may be stale —
  // show a loader, not an error
  if (!current && (workspaces.isLoading || workspaces.isFetching)) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="font-display text-lg font-bold">No access</div>
        <p className="max-w-sm text-sm text-muted">
          Workspace “{slug}” is not among yours. Ask the owner for an invite link
          or pick another workspace.
        </p>
        <Link to="/workspaces" className="rounded bg-ink px-4 py-2 text-sm font-medium text-surface">
          My workspaces
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
  // key={slug}: switching workspaces remounts the tree — local page state
  // does not survive the switch
  return (
    <WorkspaceCtx.Provider key={current.slug} value={value}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
