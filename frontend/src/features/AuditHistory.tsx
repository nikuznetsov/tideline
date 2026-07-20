import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface AuditEntry {
  id: number;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_LABEL: Record<string, string> = {
  create: "создание",
  update: "изменение",
  delete: "удаление",
  soft_delete: "удаление",
  add_update: "апдейт",
  replace_milestones: "вехи",
  close_week: "закрытие недели",
  undo_close_week: "откат закрытия",
  revoke: "отзыв",
};

function diffLine(entry: AuditEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const parts: string[] = [];
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const fmt = (v: unknown) =>
      v === null || v === undefined || v === ""
        ? "—"
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
    if (b === undefined) parts.push(`${k}: ${fmt(a)}`);
    else if (a === undefined) parts.push(`${k}: ${fmt(b)} → —`);
    else parts.push(`${k}: ${fmt(b)} → ${fmt(a)}`);
  }
  return parts.join(" · ");
}

export function AuditHistory({
  entityType,
  entityId,
  limit = 30,
}: {
  entityType: string;
  entityId: string;
  limit?: number;
}) {
  const query = useQuery<AuditEntry[]>({
    queryKey: ["audit", entityType, entityId],
    queryFn: () =>
      api.get<AuditEntry[]>(
        `/audit?entity_type=${entityType}&entity_id=${entityId}&limit=${limit}`,
      ),
  });

  if (query.isLoading)
    return <p className="text-xs text-muted">Загрузка истории…</p>;
  if (!query.data?.length)
    return <p className="text-xs text-muted">Изменений пока не записано.</p>;

  return (
    <div className="space-y-1">
      {query.data.map((e) => (
        <div key={e.id} className="flex gap-3 text-xs">
          <span className="w-28 shrink-0 whitespace-nowrap text-muted font-nums">
            {new Date(e.created_at).toLocaleString("ru", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="w-24 shrink-0 font-medium">
            {ACTION_LABEL[e.action] ?? e.action}
          </span>
          <span className="min-w-0 break-words text-muted">{diffLine(e)}</span>
        </div>
      ))}
    </div>
  );
}
