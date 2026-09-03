import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getWorkspaceSlug, wapi } from "../api/client";
import type { ProjectDetail, ProjectLoad, ProjectUpdateEntry } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { addDays, currentMonday, rangeLabel, todayISO } from "../lib/dates";
import { AuditHistory } from "../features/AuditHistory";
import { fmtNum } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { useWorkspace } from "../workspace";
import { HealthDot } from "../components/HealthDot";

const HEALTH_LABEL: Record<string, string> = {
  green: "on track",
  amber: "needs attention",
  red: "problems",
};
const HEALTH_OPTIONS = ["green", "amber", "red"];
const LIFECYCLE_OPTIONS: [string, string][] = [
  ["active", "Active"],
  ["support", "Support"],
  ["paused", "Paused"],
  ["finished", "Finished"],
];

const CONTENT_FIELDS: [keyof ProjectDetail, string, string][] = [
  ["goal", "Goal", "Why the project exists, in one paragraph"],
  ["scope_md", "Tasks and milestones", "What the current iteration includes"],
  [
    "links_md",
    "Links",
    "Confluence, repositories, dashboards — and who to ask for access. Project details (risks, architecture, decisions) live in Confluence.",
  ],
];

export function ProjectCardPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit, wsPath } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
  const deleteProject = useMutation({
    mutationFn: () => wapi.delete(`/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      navigate(wsPath("/projects"));
    },
  });

  const [updateText, setUpdateText] = useState("");
  const [updateHealth, setUpdateHealth] = useState<string>("");
  const [updateDate, setUpdateDate] = useState(todayISO());
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deletingUpdate, setDeletingUpdate] = useState<ProjectUpdateEntry | null>(null);

  if (project.isLoading) return <p className="py-10 text-center text-muted">Loading…</p>;
  if (!project.data)
    return (
      <p className="py-10 text-center text-sm text-muted">
        Project not found. <Link to="../projects" className="underline">Back to the list</Link>
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
        <Link to={wsPath("/projects")} className="underline">Projects</Link> / {p.code}
      </div>

      {/* ---- top: live status ---- */}
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
              <span className="font-display text-lg font-bold">{p.code} ·</span>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Escape" && setEditingName(false)}
                className="rounded border border-line bg-page px-2 py-1 font-display text-lg font-bold"
                aria-label="Project name"
              />
              <button className="text-xs font-medium text-accent underline">
                save
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                className="text-xs text-muted underline"
              >
                cancel
              </button>
            </form>
          ) : (
            <h1 className="font-display text-lg font-bold">
              {p.code} · {p.name}
              {canEdit && (
                <button
                  onClick={() => {
                    setNameDraft(p.name);
                    setEditingName(true);
                  }}
                  className="ml-2 align-middle text-xs font-normal text-muted underline hover:text-ink"
                  title="Rename project"
                >
                  ✎
                </button>
              )}
            </h1>
          )}
          <HealthDot health={p.health} />
          <select
            disabled={!canEdit}
            value={p.health}
            onChange={(e) => patch.mutate({ health: e.target.value })}
            className="rounded border border-line bg-page px-1.5 py-1 text-sm"
            title="Project health"
          >
            {HEALTH_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {HEALTH_LABEL[h]}
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
              updated {new Date(p.status_updated_at).toLocaleDateString("en-GB")}
            </span>
          )}
        </div>

        {/* load widget — links the project list to the timeline */}
        <div className="mt-4 rounded border border-line bg-page p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Project load · {rangeLabel(from, to)}
            </span>
            <span className="text-sm font-bold font-nums">
              {load.data ? `${fmtNum(load.data.total_person_days)} days` : "…"}
            </span>
          </div>
          {load.data && load.data.rows.length === 0 && (
            <p className="text-xs text-muted">
              Nobody is allocated to this project in the current window.
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

        {/* update log — any workspace participant can post */}
        <div className="mt-4">
          <form onSubmit={submitUpdate} className="mb-3 flex flex-wrap gap-2">
            <input
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              placeholder="Weekly update: what changed…"
              className="min-w-52 flex-1 rounded border border-line bg-page px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={updateDate}
              max={todayISO()}
              onChange={(e) => setUpdateDate(e.target.value)}
              className="rounded border border-line bg-page px-2 py-2 text-sm font-nums"
              title="Update date — defaults to today"
            />
            {canEdit && (
              <select
                value={updateHealth}
                onChange={(e) => setUpdateHealth(e.target.value)}
                className="rounded border border-line bg-page px-2 text-sm"
                title="Change health along with the update"
              >
                <option value="">Health unchanged</option>
                {HEALTH_OPTIONS.map((h) => (
                  <option key={h} value={h}>{HEALTH_LABEL[h]}</option>
                ))}
              </select>
            )}
            <button className="rounded bg-ink px-3 py-2 text-sm font-medium text-surface">
              Post
            </button>
          </form>
          <div className="space-y-2">
            {p.updates.map((u) => (
              <div key={u.id} className="group flex gap-3 text-sm">
                <span className="w-20 shrink-0 text-xs leading-5 text-muted font-nums">
                  {new Date(`${u.on_date}T00:00:00`).toLocaleDateString("en-GB")}
                </span>
                <span className="min-w-0">
                  {u.health_after && <HealthDot health={u.health_after} className="mr-1.5" />}
                  {u.body}
                  {u.author_name && (
                    <span className="ml-2 text-xs text-muted">— {u.author_name}</span>
                  )}
                </span>
                {canEdit && (
                  <button
                    onClick={() => setDeletingUpdate(u)}
                    className="ml-auto shrink-0 text-xs text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                    title="Delete update"
                  >
                    delete
                  </button>
                )}
              </div>
            ))}
            {p.updates.length === 0 && (
              <p className="text-xs text-muted">
                No updates yet — the first entry will appear after the weekly status.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- bottom: content (details live in Confluence) ---- */}
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
                    edit
                  </button>
                  )
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        patch.mutate({ [field]: editValue });
                        setEditField(null);
                      }}
                      className="text-xs font-medium text-accent underline"
                    >
                      save
                    </button>
                    <button
                      onClick={() => setEditField(null)}
                      className="text-xs text-muted underline"
                    >
                      cancel
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
                  placeholder="Markdown: **bold**, - lists, [links](https://…)"
                />
              ) : value ? (
                <Markdown text={value} />
              ) : (
                <p className="text-xs text-muted">{hint}{canEdit ? " — click “edit”." : ""}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* change history (audit log) */}
      <div className="mt-4 rounded-lg border border-line bg-surface p-3">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Change history
          </span>
          <span className="text-xs text-muted">{historyOpen ? "▾" : "▸"}</span>
        </button>
        {historyOpen && id && (
          <div className="mt-2">
            <AuditHistory entityType="project" entityId={id} />
          </div>
        )}
      </div>

      {/* project deletion — editor/owner, recorded in the change history */}
      {canEdit && (
        <div className="mt-4 text-right">
          <button
            onClick={() => setDeletingProject(true)}
            className="text-xs text-muted underline hover:text-accent"
          >
            Delete project
          </button>
        </div>
      )}

      {deletingProject && (
        <ConfirmDialog
          title="Delete project"
          message={
            <>
              Project <b>{p.code} · {p.name}</b> will be deleted and all of its
              load removed from the timeline. The action is recorded in the change history.
            </>
          }
          confirmLabel="Delete"
          verifyText={p.code}
          onConfirm={() => deleteProject.mutate()}
          onClose={() => setDeletingProject(false)}
        />
      )}
      {deletingUpdate && (
        <ConfirmDialog
          title="Delete update"
          message={
            <>
              Delete the update from{" "}
              <b className="font-nums">
                {new Date(`${deletingUpdate.on_date}T00:00:00`).toLocaleDateString("en-GB")}
              </b>
              {deletingUpdate.author_name && <> ({deletingUpdate.author_name})</>}?
              The action is recorded in the change history.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => deleteUpdate.mutate(deletingUpdate.id)}
          onClose={() => setDeletingUpdate(null)}
        />
      )}
    </div>
  );
}
