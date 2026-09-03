import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";
import { Wordmark } from "../components/Wordmark";

interface JoinInfo {
  workspace_name: string;
  workspace_slug: string;
}

export function JoinPage({ user }: { user: User | null }) {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const info = useQuery<JoinInfo>({
    queryKey: ["join", token],
    queryFn: () => api.get<JoinInfo>(`/join/${token}`),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => api.post<{ workspace_slug: string }>(`/join/${token}`),
    onSuccess: async (data) => {
      // the workspace list may have been cached before joining — refetch it,
      // otherwise WorkspaceShell won't find the new workspace and will show "No access"
      await queryClient.refetchQueries({ queryKey: ["workspaces"] });
      navigate(`/w/${data.workspace_slug}/`);
    },
  });

  if (info.isLoading) {
    return <div className="flex h-full items-center justify-center text-muted">Checking the invite…</div>;
  }
  if (info.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="font-display text-lg font-bold">This invite is no longer valid</div>
        <p className="max-w-sm text-sm text-muted">
          The link was revoked or mistyped. Ask the workspace owner for a new
          one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-page">
      <div className="w-[380px]">
        <div className="mb-4 flex items-baseline justify-center gap-2">
          <Wordmark size="base" />
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 text-center">
          <div className="font-display text-sm font-bold">Invitation</div>
          <p className="mt-3 text-sm">
            You have been invited to the workspace{" "}
            <b>“{info.data!.workspace_name}”</b>
          </p>
          {user ? (
            <>
              <p className="mt-1 text-xs text-muted">
                Signed in as {user.name} ({user.email})
              </p>
              {join.isError && (
                <p className="mt-3 text-xs text-accent">
                  {join.error instanceof ApiError ? join.error.message : "Could not join"}
                </p>
              )}
              <button
                onClick={() => join.mutate()}
                disabled={join.isPending}
                className="mt-4 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                {join.isPending ? "Joining…" : "Join"}
              </button>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted">
                To join, log in or create an account — you will be brought back
                here afterwards.
              </p>
              <div className="mt-4 space-y-2">
                <Link
                  to={`/login?next=${encodeURIComponent(location.pathname)}`}
                  className="block w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
                >
                  Log in
                </Link>
                <Link
                  to={`/register?next=${encodeURIComponent(location.pathname)}`}
                  className="block w-full rounded border border-line px-3 py-2 text-sm font-medium hover:bg-page"
                >
                  Create account
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
