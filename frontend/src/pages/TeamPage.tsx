import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, Fragment, useState } from "react";
import { ApiError, wapi } from "../api/client";
import type { Member } from "../api/types";
import { AuditHistory } from "../features/AuditHistory";
import { AccessSection } from "../features/AccessSection";
import { useWorkspace } from "../workspace";

export function TeamPage() {
  const { canEdit } = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const members = useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: () => wapi.get<Member[]>("/members"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };

  const create = useMutation({
    mutationFn: (body: { name: string; role_title: string | null }) =>
      wapi.post("/members", body),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить"),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      wapi.patch(`/members/${id}`, body),
    onSuccess: invalidate,
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => wapi.delete(`/members/${id}`),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (member_ids: string[]) =>
      wapi.post("/members/reorder", { member_ids }),
    onSuccess: invalidate,
  });

  function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name")).trim();
    if (!name) return;
    create.mutate({
      name,
      role_title: String(fd.get("role_title")).trim() || null,
    });
    e.currentTarget.reset();
  }

  function move(index: number, delta: number) {
    const list = members.data ?? [];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((m) => m.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  }

  const rows = members.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <h1 className="mb-4 font-wide text-lg font-bold">Команда</h1>
      <h2 className="mb-1 font-wide text-base font-bold">Сотрудники на таймлайне</h2>
      <p className="mb-4 text-xs text-muted">
        Порядок строк здесь — порядок на таймлайне. Неактивные сотрудники
        скрываются из сетки и поиска ресурса, но их история остаётся. Удаление —
        мягкое: данные не пропадают.
      </p>

      {canEdit && (
      <form
        onSubmit={submitCreate}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3"
      >
        <label className="text-xs text-muted">
          Имя
          <input
            name="name"
            required
            placeholder="Имя Фамилия"
            className="mt-1 block w-44 rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-muted">
          Роль
          <input
            name="role_title"
            placeholder="ML-инженер"
            className="mt-1 block w-56 rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-mts px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Добавить
        </button>
      </form>
      )}

      {error && <p className="mb-3 text-xs text-mts">{error}</p>}
      {members.isLoading && <p className="py-8 text-center text-muted">Загрузка…</p>}
      {members.isSuccess && rows.length === 0 && (
        <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
          В команде пока никого нет — добавьте первого сотрудника формой выше.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="w-16 px-2 py-2">Порядок</th>
                <th className="px-3 py-2">Имя</th>
                <th className="px-3 py-2">Роль</th>
                <th className="px-2 py-2">Активен</th>
                <th className="w-32 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canEdit={canEdit}
                  onPatch={(body) => patch.mutate({ id: m.id, body })}
                  onDelete={() => {
                    if (
                      window.confirm(
                        `Удалить сотрудника «${m.name}»? История аллокаций сохранится, но из сетки и поиска он исчезнет.`,
                      )
                    ) {
                      remove.mutate(m.id);
                    }
                  }}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  isFirst={i === 0}
                  isLast={i === rows.length - 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AccessSection />
    </div>
  );
}

function MemberRow({
  member,
  canEdit,
  onPatch,
  onDelete,
  onUp,
  onDown,
  isFirst,
  isLast,
}: {
  member: Member;
  canEdit: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role_title ?? "");
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <Fragment>
    <tr className={`border-b border-line/50 ${member.is_active ? "" : "opacity-50"}`}>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <button
          onClick={onUp}
          disabled={isFirst || !canEdit}
          className="rounded border border-line px-1.5 py-0.5 text-xs hover:bg-page disabled:opacity-30"
          title="Выше на таймлайне"
        >
          ↑
        </button>
        <button
          onClick={onDown}
          disabled={isLast || !canEdit}
          className="ml-1 rounded border border-line px-1.5 py-0.5 text-xs hover:bg-page disabled:opacity-30"
          title="Ниже на таймлайне"
        >
          ↓
        </button>
      </td>
      <td className="px-3 py-1.5">
        <input
          value={name}
          readOnly={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== member.name && onPatch({ name: name.trim() })}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-line focus:border-line focus:bg-page"
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          value={role}
          readOnly={!canEdit}
          onChange={(e) => setRole(e.target.value)}
          onBlur={() =>
            role !== (member.role_title ?? "") && onPatch({ role_title: role.trim() || null })
          }
          placeholder="—"
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-muted hover:border-line focus:border-line focus:bg-page"
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={member.is_active}
          onChange={(e) => onPatch({ is_active: e.target.checked })}
          title={member.is_active ? "Скрыть из сетки и поиска" : "Вернуть в сетку"}
        />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="mr-2 text-xs text-muted underline hover:text-ink"
          title="История изменений сотрудника"
        >
          история
        </button>
        {canEdit && (
        <button onClick={onDelete} className="text-xs text-mts underline">
          Удалить
        </button>
        )}
      </td>
    </tr>
    {historyOpen && (
      <tr className="border-b border-line/50 bg-page/50">
        <td colSpan={5} className="px-4 py-2">
          <AuditHistory entityType="member" entityId={member.id} />
        </td>
      </tr>
    )}
    </Fragment>
  );
}
