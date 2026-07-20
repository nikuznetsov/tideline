import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, wapi } from "../api/client";
import { CopyButton } from "../components/CopyButton";
import type { Member } from "../api/types";
import { useWorkspace } from "../workspace";

interface Participant {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

interface InviteLinkItem {
  id: string;
  token_prefix: string;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
  token?: string;
  url?: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  editor: "Редактор",
  viewer: "Просмотр",
};

export function AccessSection() {
  const { current, isOwner } = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const base = `/w/${current.slug}`;

  const members = useQuery<Member[]>({
    queryKey: ["members", current.slug],
    queryFn: () => wapi.get<Member[]>("/members"),
  });
  const addToTeam = useMutation({
    mutationFn: (userId: string) => wapi.post("/members", { user_id: userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить"),
  });
  const teamUserIds = new Set((members.data ?? []).map((m) => m.user_id).filter(Boolean));

  const participants = useQuery<Participant[]>({
    queryKey: ["participants", current.slug],
    queryFn: () => api.get<Participant[]>(`${base}/participants`),
  });
  const invites = useQuery<InviteLinkItem[]>({
    queryKey: ["invite-links", current.slug],
    queryFn: () => api.get<InviteLinkItem[]>(`${base}/invite-links`),
    enabled: isOwner,
  });

  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
  const invalidate = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["participants", current.slug] });
  };

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`${base}/participants/${userId}`, { role }),
    onSuccess: invalidate,
    onError,
  });
  const removeParticipant = useMutation({
    mutationFn: (userId: string) => api.delete(`${base}/participants/${userId}`),
    onSuccess: invalidate,
    onError,
  });
  const patchWorkspace = useMutation({
    mutationFn: (default_member_role: string) =>
      api.patch(`${base}`, { default_member_role }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    onError,
  });
  const createInvite = useMutation({
    mutationFn: () => api.post<InviteLinkItem>(`${base}/invite-links`),
    onSuccess: (link) => {
      setCreatedUrl(`${window.location.origin}/join/${link.token}`);
      queryClient.invalidateQueries({ queryKey: ["invite-links", current.slug] });
    },
    onError,
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/invite-links/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["invite-links", current.slug] }),
    onError,
  });

  const activeInvites = (invites.data ?? []).filter((l) => !l.revoked_at);

  return (
    <section className="mt-8">
      <h2 className="mb-1 font-wide text-base font-bold">Доступ в пространство</h2>
      <p className="mb-4 text-xs text-muted">
        Аккаунты с доступом к «{current.name}» и их роли. Команда выше — это
        участники, добавленные на таймлайн: в команде у всех есть доступ, но не
        все, у кого есть доступ, в команде.
      </p>
      {error && <p className="mb-3 text-xs text-mts">{error}</p>}

      <div className="rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Имя</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Роль</th>
              {isOwner && <th className="w-20 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {(participants.data ?? []).map((p) => (
              <tr key={p.user_id} className="border-b border-line/50">
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2 text-muted">{p.email}</td>
                <td className="px-3 py-2">
                  {isOwner ? (
                    <select
                      value={p.role}
                      onChange={(e) =>
                        changeRole.mutate({ userId: p.user_id, role: e.target.value })
                      }
                      className="rounded border border-line bg-page px-1.5 py-1 text-xs"
                    >
                      {Object.entries(ROLE_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs">{ROLE_LABEL[p.role] ?? p.role}</span>
                  )}
                </td>
                {isOwner && (
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {!teamUserIds.has(p.user_id) && (
                      <button
                        onClick={() => addToTeam.mutate(p.user_id)}
                        className="mr-2 text-xs text-muted underline hover:text-ink"
                        title="Добавить в команду — появится строка на таймлайне"
                      >
                        в команду
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (window.confirm(`Убрать доступ у «${p.name}»?`))
                          removeParticipant.mutate(p.user_id);
                      }}
                      className="text-xs text-mts underline"
                    >
                      Убрать
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isOwner && (
        <>
          <div className="mt-6 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-medium">Роль по умолчанию</h2>
            <p className="mt-1 text-xs text-muted">
              С этой ролью входят все, кто вступает по ссылке-приглашению.
            </p>
            <select
              value={current.default_member_role}
              onChange={(e) => patchWorkspace.mutate(e.target.value)}
              className="mt-2 rounded border border-line bg-page px-2 py-1.5 text-sm"
            >
              <option value="viewer">Просмотр</option>
              <option value="editor">Редактор</option>
            </select>
          </div>

          <div className="mt-4 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Ссылки-приглашения</h2>
              <button
                onClick={() => createInvite.mutate()}
                disabled={createInvite.isPending}
                className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
              >
                Создать ссылку
              </button>
            </div>
            {createdUrl && (
              <div className="mt-3 rounded border border-line bg-page p-3">
                <div className="mb-1 text-xs font-medium">Новая ссылка</div>
                <div className="break-all font-nums text-xs">{createdUrl}</div>
                <CopyButton
                  text={createdUrl}
                  className="mt-2 rounded border border-line px-2 py-1 text-xs hover:bg-surface"
                />
              </div>
            )}
            <div className="mt-3 space-y-1.5">
              {invites.isSuccess && activeInvites.length === 0 && !createdUrl && (
                <p className="text-xs text-muted">
                  Активных ссылок нет — создайте, чтобы позвать команду.
                </p>
              )}
              {activeInvites.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between rounded border border-line px-3 py-1.5"
                >
                  <div className="text-xs">
                    <span className="font-nums">{l.token_prefix}…</span>
                    <span className="ml-2 text-muted">
                      создана {new Date(l.created_at).toLocaleDateString("ru")}
                      {l.last_used_at &&
                        ` · использовалась ${new Date(l.last_used_at).toLocaleDateString("ru")}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {l.url && (
                      <CopyButton
                        text={l.url}
                        className="text-xs underline hover:text-ink"
                      />
                    )}
                    <button
                      onClick={() => revokeInvite.mutate(l.id)}
                      className="text-xs text-mts underline"
                    >
                      Отозвать
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
