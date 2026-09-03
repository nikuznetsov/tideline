import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProfileDialog } from "../components/ProfileDialog";
import { LAST_WS_KEY, useMyWorkspaces, WorkspaceInfo } from "../workspace";
import { Wordmark } from "../components/Wordmark";

const ROLE_LABEL: Record<string, string> = {
  owner: "owner",
  editor: "editor",
  viewer: "viewer",
};

function slugify(name: string): string {
  // transliteration table so Cyrillic workspace names still produce a usable slug
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return name
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function WorkspacesPage({ user }: { user: User }) {
  const workspaces = useMyWorkspaces();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceInfo | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      api.post<WorkspaceInfo>("/workspaces", body),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/w/${ws.slug}/`);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not create"),
  });

  const remove = useMutation({
    mutationFn: (ws: WorkspaceInfo) => api.delete(`/w/${ws.slug}`),
    onSuccess: (_data, ws) => {
      if (localStorage.getItem(LAST_WS_KEY) === ws.slug)
        localStorage.removeItem(LAST_WS_KEY);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not delete"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ name: name.trim(), slug: slug.trim() });
  }

  const list = workspaces.data ?? [];

  return (
    <div className="min-h-full overflow-auto bg-page">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-6 pt-6">
        <div className="flex items-baseline gap-2">
          <Wordmark size="base" />
        </div>
        <button
          onClick={() => setProfileOpen(true)}
          className="max-w-40 truncate text-xs text-muted hover:text-ink"
          title="My profile"
        >
          {user.name}
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="font-display text-lg font-bold">My workspaces</h1>

        {workspaces.isLoading && <p className="py-6 text-muted">Loading…</p>}
        {workspaces.isSuccess && list.length === 0 && (
          <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-6 text-sm text-muted">
            You have no access yet. Join a workspace via an invite link from
            its owner — or create your own below.
          </p>
        )}
        {list.length > 0 && (
          <div className="mt-3 space-y-2">
            {list.map((w) => (
              <Link
                key={w.id}
                to={`/w/${w.slug}/`}
                className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-accent/50"
              >
                <div>
                  <div className="text-sm font-medium">{w.name}</div>
                  <div className="text-xs text-muted font-nums">/{w.slug}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                    {ROLE_LABEL[w.role] ?? w.role}
                  </span>
                  {w.role === "owner" && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleting(w);
                      }}
                      className="text-xs text-accent underline"
                      title="Delete the entire workspace"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        <form
          onSubmit={submit}
          className="mt-6 rounded-lg border border-line bg-surface p-4"
        >
          <h2 className="text-sm font-medium">Create workspace</h2>
          <p className="mt-1 text-xs text-muted">
            You will be its owner: the team, projects and invitations are under
            your control.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs text-muted">
              Name
              <input
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="ML Platform team"
                className="mt-1 block w-full rounded border border-line bg-page px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="text-xs text-muted">
              Address
              <div className="mt-1 flex items-center rounded border border-line bg-page px-2">
                <span className="text-xs text-muted">/w/</span>
                <input
                  required
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase());
                    setSlugTouched(true);
                  }}
                  pattern="[a-z0-9][a-z0-9-]{1,31}"
                  title="Lowercase letters, digits and hyphens"
                  className="w-36 bg-transparent px-1 py-2 text-sm text-ink outline-none"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            >
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-accent">{error}</p>}
        </form>
      </main>
      {profileOpen && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete workspace"
          message={
            <>
              The workspace <b>“{deleting.name}”</b> will be deleted permanently —
              along with its team, projects, timeline, history and all links.
              Every participant will lose access.
            </>
          }
          confirmLabel="Delete forever"
          verifyText={deleting.slug}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
