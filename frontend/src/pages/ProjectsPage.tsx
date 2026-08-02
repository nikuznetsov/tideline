import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { getWorkspaceSlug, wapi, workspaceUrl } from "../api/client";
import type { ProjectListItem } from "../api/types";
import { useWorkspace } from "../workspace";

const HEALTH: Record<string, string> = { green: "🟢", amber: "🟡", red: "🔴" };
const LIFECYCLE: Record<string, string> = {
  active: "Активен",
  support: "Поддержка",
  paused: "Приостановлен",
  finished: "Завершён",
};

export function ProjectsPage() {
  const { canEdit, wsPath } = useWorkspace();
  const [showFinished, setShowFinished] = useState(false);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const projects = useQuery<ProjectListItem[]>({
    queryKey: ["projects", showFinished, getWorkspaceSlug()],
    queryFn: () =>
      wapi.get<ProjectListItem[]>(`/projects?include_finished=${showFinished}`),
  });

  const create = useMutation({
    mutationFn: (body: { code: string; name: string }) =>
      wapi.post("/projects", body),
    onSuccess: () => {
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const rows = projects.data ?? [];

  function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    create.mutate({
      code: String(fd.get("code")).toUpperCase(),
      name: String(fd.get("name")),
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="font-wide text-lg font-bold">Проекты</h1>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={showFinished}
            onChange={(e) => setShowFinished(e.target.checked)}
          />
          показывать завершённые
        </label>
        <div className="ml-auto flex gap-2">
          <a
            href={workspaceUrl("/export/projects.xlsx")}
            className="rounded border border-line px-2 py-1 text-xs hover:bg-page"
          >
            XLSX
          </a>
          {canEdit && (
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded bg-ink px-3 py-1 text-xs font-medium text-surface"
          >
            + Проект
          </button>
          )}
        </div>
      </div>

      {creating && (
        <form
          onSubmit={submitCreate}
          className="mb-3 flex items-end gap-2 rounded border border-line bg-surface p-3"
        >
          <label className="text-xs text-muted">
            Код
            <input
              name="code"
              required
              maxLength={8}
              placeholder="RAGX"
              className="mt-1 block w-28 rounded border border-line bg-page px-2 py-1.5 text-sm uppercase text-ink"
            />
          </label>
          <label className="flex-1 text-xs text-muted">
            Название
            <input
              name="name"
              required
              placeholder="RAG-платформа для поддержки"
              className="mt-1 block w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button className="rounded bg-mts px-3 py-1.5 text-sm font-medium text-white">
            Создать
          </button>
        </form>
      )}

      {projects.isLoading && <p className="py-8 text-center text-muted">Загрузка…</p>}
      {projects.isSuccess && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">
          Проектов пока нет — создайте первый кнопкой «+ Проект».
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Код</th>
                <th className="px-3 py-2">Название · апдейт недели</th>
                <th className="px-2 py-2" title="Светофор проекта: 🟢 в порядке, 🟡 требует внимания, 🔴 проблемы">Светофор</th>
                <th className="px-3 py-2">Статус</th>
                <th className="w-20 py-2 pl-2 pr-4 text-right">Людей</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-line/50 hover:bg-page ${
                    p.lifecycle === "finished" ? "opacity-50" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link to={wsPath(`/projects/${p.id}`)} className="font-medium text-mts">
                      {p.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link to={wsPath(`/projects/${p.id}`)}>{p.name}</Link>
                    {p.weekly_update && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted">
                        {p.weekly_update}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">{HEALTH[p.health]}</td>
                  <td className="px-3 py-2 text-xs">{LIFECYCLE[p.lifecycle]}</td>
                  <td className="py-2 pl-2 pr-4 text-right font-nums">
                    {p.active_members_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
