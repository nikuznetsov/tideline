import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";
import { ProfileDialog } from "../components/ProfileDialog";
import { useMyWorkspaces, WorkspaceInfo } from "../workspace";

const ROLE_LABEL: Record<string, string> = {
  owner: "владелец",
  editor: "редактор",
  viewer: "просмотр",
};

function slugify(name: string): string {
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

  const create = useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      api.post<WorkspaceInfo>("/workspaces", body),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/w/${ws.slug}/`);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Не удалось создать"),
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
          <span className="font-wide text-base font-bold uppercase">xOps</span>
          <span className="font-wide text-base font-medium text-mts">Tideline</span>
        </div>
        <button
          onClick={() => setProfileOpen(true)}
          className="max-w-40 truncate text-xs text-muted hover:text-ink"
          title="Мой профиль"
        >
          {user.name}
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="font-wide text-lg font-bold">Мои пространства</h1>

        {workspaces.isLoading && <p className="py-6 text-muted">Загрузка…</p>}
        {workspaces.isSuccess && list.length === 0 && (
          <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-6 text-sm text-muted">
            У вас пока нет доступов. Вступите в пространство по
            ссылке-приглашению от владельца — или создайте своё ниже.
          </p>
        )}
        {list.length > 0 && (
          <div className="mt-3 space-y-2">
            {list.map((w) => (
              <Link
                key={w.id}
                to={`/w/${w.slug}/`}
                className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-mts/50"
              >
                <div>
                  <div className="text-sm font-medium">{w.name}</div>
                  <div className="text-xs text-muted font-nums">/{w.slug}</div>
                </div>
                <span className="rounded bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                  {ROLE_LABEL[w.role] ?? w.role}
                </span>
              </Link>
            ))}
          </div>
        )}

        <form
          onSubmit={submit}
          className="mt-6 rounded-lg border border-line bg-surface p-4"
        >
          <h2 className="text-sm font-medium">Создать пространство</h2>
          <p className="mt-1 text-xs text-muted">
            Вы станете его владельцем: команда, проекты и приглашения — под вашим
            управлением.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs text-muted">
              Название
              <input
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Команда ML-платформы"
                className="mt-1 block w-full rounded border border-line bg-page px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="text-xs text-muted">
              Адрес
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
                  title="Латиница, цифры и дефис"
                  className="w-36 bg-transparent px-1 py-2 text-sm text-ink outline-none"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded bg-mts px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Создать
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-mts">{error}</p>}
        </form>
      </main>
      {profileOpen && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
