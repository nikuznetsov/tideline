import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getWorkspaceSlug, wapi } from "../api/client";
import { CopyButton } from "../components/CopyButton";
import type { ShareLinkItem } from "../api/types";

export function SharePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<ShareLinkItem | null>(null);

  const links = useQuery<ShareLinkItem[]>({
    queryKey: ["share-links", getWorkspaceSlug()],
    queryFn: () => wapi.get<ShareLinkItem[]>("/share-links"),
  });

  const create = useMutation({
    mutationFn: () => wapi.post<ShareLinkItem>("/share-links", {}),
    onSuccess: (link) => {
      setCreated(link);
      queryClient.invalidateQueries({ queryKey: ["share-links"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => wapi.delete(`/share-links/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["share-links"] }),
  });

  const active = (links.data ?? []).filter((l) => !l.revoked_at);

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-full flex-col border-l border-line bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-wide text-sm font-bold">Read-only ссылки</h2>
        <button onClick={onClose} className="text-muted hover:text-ink">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <p className="mb-3 text-xs text-muted">
          Ссылка открывает таймлайн и реестр проектов в режиме чтения, без
          логина.
        </p>
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="mb-4 w-full rounded bg-ink py-2 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
        >
          Создать ссылку
        </button>
        {created && (
          <div className="mb-4 rounded border border-line bg-page p-3">
            <div className="mb-1 text-xs font-medium">Новая ссылка</div>
            <div className="break-all font-nums text-xs">{`${window.location.origin}/s/${created.token}`}</div>
            <CopyButton
              text={`${window.location.origin}/s/${created.token}`}
              className="mt-2 rounded border border-line px-2 py-1 text-xs hover:bg-surface"
            />
          </div>
        )}
        <div className="space-y-2">
          {active.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded border border-line px-3 py-2"
            >
              <div>
                <div className="font-nums text-xs">{l.token_prefix}…</div>
                <div className="text-[10px] text-muted">
                  создана {new Date(l.created_at).toLocaleDateString("ru")}
                  {l.last_accessed_at &&
                    ` · открывалась ${new Date(l.last_accessed_at).toLocaleDateString("ru")}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {l.url && (
                  <CopyButton
                    text={l.url}
                    className="text-xs underline hover:text-ink"
                  />
                )}
                <button
                  onClick={() => revoke.mutate(l.id)}
                  className="text-xs text-mts underline"
                >
                  Отозвать
                </button>
              </div>
            </div>
          ))}
          {links.isSuccess && active.length === 0 && !created && (
            <p className="text-xs text-muted">Активных ссылок нет.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
