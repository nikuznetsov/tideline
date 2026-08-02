import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getWorkspaceSlug, wapi } from "../api/client";
import type { ProjectDetail, ProjectLoad } from "../api/types";
import { addDays, currentMonday, rangeLabel, todayISO } from "../lib/dates";
import { AuditHistory } from "../features/AuditHistory";
import { fmtNum } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { useWorkspace } from "../workspace";

const HEALTH: Record<string, string> = { green: "🟢", amber: "🟡", red: "🔴" };
const HEALTH_LABEL: Record<string, string> = {
  green: "в порядке",
  amber: "требует внимания",
  red: "проблемы",
};
const HEALTH_OPTIONS = ["green", "amber", "red"];
const LIFECYCLE_OPTIONS: [string, string][] = [
  ["active", "Активен"],
  ["support", "Поддержка"],
  ["paused", "Приостановлен"],
  ["finished", "Завершён"],
];

const CONTENT_FIELDS: [keyof ProjectDetail, string, string][] = [
  ["goal", "Цель", "Зачем проект существует, одним абзацем"],
  ["scope_md", "Задачи и вехи", "Что входит в текущую итерацию"],
  [
    "links_md",
    "Ссылки",
    "Confluence, репозитории, дашборды — и к кому идти за доступом. Детали проекта (риски, архитектура, решения) живут в Confluence.",
  ],
];

export function ProjectCardPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit, wsPath } = useWorkspace();
  const queryClient = useQueryClient();
  const from = currentMonday();
  const to = addDays(from, 13);

  const project = useQuery<ProjectDetail>({
    queryKey: ["project", id, getWorkspaceSlug()],
    queryFn: () => wapi.get<ProjectDetail>(`/projects/${id}`),
  });
  const load = useQuery<ProjectLoad>({
    queryKey: ["project-load", id, from, getWorkspaceSlug()],
    queryFn: () => wapi.get<ProjectLoad>(`/projects/${id}/load?from=${from}&to=${to}`),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => wapi.patch(`/projects/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });
  const addUpdate = useMutation({
    mutationFn: (body: { body: string; health_after: string | null; on_date: string }) =>
      wapi.post(`/projects/${id}/updates`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });
  const deleteUpdate = useMutation({
    mutationFn: (updateId: string) =>
      wapi.delete(`/projects/${id}/updates/${updateId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });

  const [updateText, setUpdateText] = useState("");
  const [updateHealth, setUpdateHealth] = useState<string>("");
  const [updateDate, setUpdateDate] = useState(todayISO());
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  if (project.isLoading) return <p className="py-10 text-center text-muted">Загрузка…</p>;
  if (!project.data)
    return (
      <p className="py-10 text-center text-sm text-muted">
        Проект не найден. <Link to="../projects" className="underline">К реестру</Link>
      </p>
    );
  const p = project.data;

  function submitUpdate(e: FormEvent) {
    e.preventDefault();
    if (!updateText.trim()) return;
    addUpdate.mutate({
      body: updateText.trim(),
      health_after: updateHealth || null,
      on_date: updateDate || todayISO(),
    });
    setUpdateText("");
    setUpdateHealth("");
    setUpdateDate(todayISO());
  }

  function saveName() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (name && name !== p.name) patch.mutate({ name });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <div className="mb-1 text-xs text-muted">
        <Link to={wsPath("/projects")} className="underline">Проекты</Link> / {p.code}
      </div>

      {/* ---- верх: живой статус ---- */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
              className="flex items-center gap-2"
            >
              <span className="font-wide text-lg font-bold">{p.code} ·</span>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Escape" && setEditingName(false)}
                className="rounded border border-line bg-page px-2 py-1 font-wide text-lg font-bold"
                aria-label="Название проекта"
              />
              <button className="text-xs font-medium text-mts underline">
                сохранить
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                className="text-xs text-muted underline"
              >
                отмена
              </button>
            </form>
          ) : (
            <h1 className="font-wide text-lg font-bold">
              {p.code} · {p.name}
              {canEdit && (
                <button
                  onClick={() => {
                    setNameDraft(p.name);
                    setEditingName(true);
                  }}
                  className="ml-2 align-middle text-xs font-normal text-muted underline hover:text-ink"
                  title="Переименовать проект"
                >
                  ✎
                </button>
              )}
            </h1>
          )}
          <select
            disabled={!canEdit}
            value={p.health}
            onChange={(e) => patch.mutate({ health: e.target.value })}
            className="rounded border border-line bg-page px-1.5 py-1 text-sm"
            title="Светофор проекта"
          >
            {HEALTH_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {HEALTH[h]} {HEALTH_LABEL[h]}
              </option>
            ))}
          </select>
          <select
            disabled={!canEdit}
            value={p.lifecycle}
            onChange={(e) => patch.mutate({ lifecycle: e.target.value })}
            className="rounded border border-line bg-page px-1.5 py-1 text-sm"
          >
            {LIFECYCLE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          {p.status_updated_at && (
            <span className="ml-auto text-xs text-muted">
              обновлено {new Date(p.status_updated_at).toLocaleDateString("ru")}
            </span>
          )}
        </div>

        {/* виджет загрузки — связь реестра с таймлайном */}
        <div className="mt-4 rounded border border-line bg-page p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Загрузка проекта · {rangeLabel(from, to)}
            </span>
            <span className="text-sm font-bold font-nums">
              {load.data ? `${fmtNum(load.data.total_person_days)} дн.` : "…"}
            </span>
          </div>
          {load.data && load.data.rows.length === 0 && (
            <p className="text-xs text-muted">
              В текущем окне на проект никто не аллоцирован.
            </p>
          )}
          {load.data && load.data.rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {load.data.rows.map((r) => (
                <span
                  key={r.member.id}
                  className="rounded bg-surface px-2 py-1 text-xs"
                >
                  {r.member.name}{" "}
                  <b className="font-nums">{fmtNum(r.person_days)}</b>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* лог апдейтов — писать может любой участник пространства */}
        <div className="mt-4">
          <form onSubmit={submitUpdate} className="mb-3 flex flex-wrap gap-2">
            <input
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              placeholder="Апдейт недели: что изменилось…"
              className="min-w-52 flex-1 rounded border border-line bg-page px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={updateDate}
              max={todayISO()}
              onChange={(e) => setUpdateDate(e.target.value)}
              className="rounded border border-line bg-page px-2 py-2 text-sm font-nums"
              title="Дата апдейта — по умолчанию сегодня"
            />
            {canEdit && (
              <select
                value={updateHealth}
                onChange={(e) => setUpdateHealth(e.target.value)}
                className="rounded border border-line bg-page px-2 text-sm"
                title="Сменить светофор вместе с апдейтом"
              >
                <option value="">Светофор без изменений</option>
                {HEALTH_OPTIONS.map((h) => (
                  <option key={h} value={h}>{HEALTH[h]} {HEALTH_LABEL[h]}</option>
                ))}
              </select>
            )}
            <button className="rounded bg-ink px-3 py-2 text-sm font-medium text-surface">
              Записать
            </button>
          </form>
          <div className="space-y-2">
            {p.updates.map((u) => (
              <div key={u.id} className="group flex gap-3 text-sm">
                <span className="w-20 shrink-0 text-xs leading-5 text-muted font-nums">
                  {new Date(`${u.on_date}T00:00:00`).toLocaleDateString("ru")}
                </span>
                <span className="min-w-0">
                  {u.health_after && <span className="mr-1">{HEALTH[u.health_after]}</span>}
                  {u.body}
                  {u.author_name && (
                    <span className="ml-2 text-xs text-muted">— {u.author_name}</span>
                  )}
                </span>
                {canEdit && (
                  <button
                    onClick={() => {
                      if (confirm("Удалить этот апдейт? Действие попадёт в историю изменений."))
                        deleteUpdate.mutate(u.id);
                    }}
                    className="ml-auto shrink-0 text-xs text-muted opacity-0 transition-opacity hover:text-mts group-hover:opacity-100"
                    title="Удалить апдейт"
                  >
                    удалить
                  </button>
                )}
              </div>
            ))}
            {p.updates.length === 0 && (
              <p className="text-xs text-muted">
                Апдейтов пока нет — первая запись появится после еженедельного статуса.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- низ: содержательная часть (детали — в Confluence) ---- */}
      <div className="mt-4 space-y-3">
        {CONTENT_FIELDS.map(([field, label, hint]) => {
          const value = (p[field] as string | null) ?? "";
          const isEditing = editField === field;
          return (
            <div key={field} className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  {label}
                </span>
                {!isEditing ? (
                  canEdit && (
                  <button
                    onClick={() => {
                      setEditField(field);
                      setEditValue(value);
                    }}
                    className="text-xs text-muted underline hover:text-ink"
                  >
                    править
                  </button>
                  )
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        patch.mutate({ [field]: editValue });
                        setEditField(null);
                      }}
                      className="text-xs font-medium text-mts underline"
                    >
                      сохранить
                    </button>
                    <button
                      onClick={() => setEditField(null)}
                      className="text-xs text-muted underline"
                    >
                      отмена
                    </button>
                  </div>
                )}
              </div>
              {isEditing ? (
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  rows={6}
                  autoFocus
                  className="w-full rounded border border-line bg-page p-2 font-mono text-xs"
                  placeholder="Markdown: **жирный**, - списки, [ссылки](https://…)"
                />
              ) : value ? (
                <Markdown text={value} />
              ) : (
                <p className="text-xs text-muted">{hint}{canEdit ? " — нажмите «править»." : ""}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* история изменений (аудит) */}
      <div className="mt-4 rounded-lg border border-line bg-surface p-3">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            История изменений
          </span>
          <span className="text-xs text-muted">{historyOpen ? "▾" : "▸"}</span>
        </button>
        {historyOpen && id && (
          <div className="mt-2">
            <AuditHistory entityType="project" entityId={id} />
          </div>
        )}
      </div>
    </div>
  );
}
