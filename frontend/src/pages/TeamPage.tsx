import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { api, ApiError, getWorkspaceSlug, wapi } from "../api/client";
import type { Member } from "../api/types";
import { AccessSection } from "../features/AccessSection";
import { AuditHistory } from "../features/AuditHistory";
import { useWorkspace } from "../workspace";

interface Participant {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

export function TeamPage() {
  const { canEdit, current } = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState("");
  const [roleTitle, setRoleTitle] = useState("");

  const members = useQuery<Member[]>({
    queryKey: ["members", getWorkspaceSlug()],
    queryFn: () => wapi.get<Member[]>("/members"),
  });
  const participants = useQuery<Participant[]>({
    queryKey: ["participants", current.slug],
    queryFn: () => api.get<Participant[]>(`/w/${current.slug}/participants`),
  });

  const invalidate = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };
  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : "Не удалось сохранить");

  const create = useMutation({
    mutationFn: (body: { user_id: string; role_title: string | null }) =>
      wapi.post("/members", body),
    onSuccess: () => {
      setSelectedUser("");
      setRoleTitle("");
      invalidate();
    },
    onError,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      wapi.patch(`/members/${id}`, body),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => wapi.delete(`/members/${id}`),
    onSuccess: invalidate,
    onError,
  });
  const reorder = useMutation({
    mutationFn: (member_ids: string[]) =>
      wapi.post("/members/reorder", { member_ids }),
    onSuccess: invalidate,
    onError,
  });

  function move(index: number, delta: number) {
    const list = members.data ?? [];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((m) => m.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  }

  const rows = members.data ?? [];
  const teamUserIds = new Set(rows.map((m) => m.user_id).filter(Boolean));
  const candidates = (participants.data ?? []).filter(
    (p) => !teamUserIds.has(p.user_id),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <h1 className="mb-4 font-wide text-lg font-bold">Команда</h1>
      <h2 className="mb-1 font-wide text-base font-bold">Сотрудники на таймлайне</h2>
      <p className="mb-4 text-xs text-muted">
        Команда собирается из участников пространства: у каждого сотрудника есть
        аккаунт и доступ. Порядок строк здесь — порядок на таймлайне; удаление
        мягкое, история аллокаций остаётся.
      </p>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedUser)
              create.mutate({
                user_id: selectedUser,
                role_title: roleTitle.trim() || null,
              });
          }}
          className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3"
        >
          <label className="text-xs text-muted">
            Участник
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              required
              className="mt-1 block w-56 rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            >
              <option value="">— выберите —</option>
              {candidates.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name} ({p.email})
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-xs text-muted">
            Роль в команде
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="ML-инженер"
              className="mt-1 block w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending || !selectedUser}
            className="rounded bg-mts px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            В команду
          </button>
          {participants.isSuccess && candidates.length === 0 && (
            <span className="text-xs text-muted">
              Все участники уже в команде — новых можно позвать инвайт-ссылкой ниже.
            </span>
          )}
        </form>
      )}

      {error && <p className="mb-3 text-xs text-mts">{error}</p>}
      {members.isLoading && <p className="py-8 text-center text-muted">Загрузка…</p>}
      {members.isSuccess && rows.length === 0 && (
        <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
          В команде пока никого нет. Пригласите людей ссылкой из блока
          «Доступ в пространство» ниже и добавьте их сюда.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="w-16 px-2 py-2">Порядок</th>
                <th className="px-3 py-2">Сотрудник</th>
                <th className="px-3 py-2">Роль в команде</th>
                <th className="px-2 py-2">Активен</th>
                <th className="w-40 px-2 py-2" />
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
                        `Убрать «${m.name}» из команды? Доступ в пространство останется, история аллокаций сохранится.`,
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
  const [role, setRole] = useState(member.role_title ?? "");
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <Fragment>
      <tr className={`border-b border-line/50 ${member.is_active ? "" : "opacity-50"}`}>
        <td className="whitespace-nowrap px-2 py-1.5">
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
          <div>{member.name}</div>
          {member.email && (
            <div className="text-xs text-muted">{member.email}</div>
          )}
        </td>
        <td className="px-3 py-1.5">
          <input
            value={role}
            readOnly={!canEdit}
            onChange={(e) => setRole(e.target.value)}
            onBlur={() =>
              role !== (member.role_title ?? "") &&
              onPatch({ role_title: role.trim() || null })
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
              Убрать из команды
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
