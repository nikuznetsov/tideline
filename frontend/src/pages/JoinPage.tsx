import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";

interface JoinInfo {
  workspace_name: string;
  workspace_slug: string;
}

export function JoinPage({ user }: { user: User | null }) {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const info = useQuery<JoinInfo>({
    queryKey: ["join", token],
    queryFn: () => api.get<JoinInfo>(`/join/${token}`),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => api.post<{ workspace_slug: string }>(`/join/${token}`),
    onSuccess: (data) => navigate(`/w/${data.workspace_slug}/`),
  });

  if (!user) {
    return (
      <Navigate to={`/?next=${encodeURIComponent(location.pathname)}`} replace />
    );
  }

  if (info.isLoading) {
    return <div className="flex h-full items-center justify-center text-muted">Проверяем приглашение…</div>;
  }
  if (info.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="font-wide text-lg font-bold">Приглашение не действует</div>
        <p className="max-w-sm text-sm text-muted">
          Ссылка отозвана или введена с ошибкой. Запросите новую у владельца
          пространства.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-page">
      <div className="w-[380px] rounded-lg border border-line bg-surface p-6 text-center">
        <div className="font-wide text-sm font-bold">Приглашение</div>
        <p className="mt-3 text-sm">
          Вас приглашают в пространство{" "}
          <b>«{info.data!.workspace_name}»</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          Вы вошли как {user.name} ({user.email})
        </p>
        {join.isError && (
          <p className="mt-3 text-xs text-mts">
            {join.error instanceof ApiError ? join.error.message : "Не удалось вступить"}
          </p>
        )}
        <button
          onClick={() => join.mutate()}
          disabled={join.isPending}
          className="mt-4 w-full rounded bg-mts px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {join.isPending ? "Вступаем…" : "Вступить"}
        </button>
      </div>
    </div>
  );
}
