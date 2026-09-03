import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { Wordmark } from "../components/Wordmark";

export function LoginPage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      // App re-renders as authenticated and redirects to next / the workspace
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in — check your connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center overflow-auto bg-page py-8">
      <div className="w-[380px]">
        <div className="mb-4 flex items-baseline gap-2">
          <Wordmark size="base" />
        </div>
        <form
          onSubmit={submit}
          className="rounded-lg border border-line bg-surface p-6"
        >
          <h1 className="font-display text-sm font-bold">Log in</h1>
          {next?.startsWith("/join/") && (
            <p className="mt-1 text-xs text-muted">
              After logging in you will return to the invitation.
            </p>
          )}
          <label className="mt-4 block">
            <span className="mb-1 block text-xs text-muted">Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-muted">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          {error && <p className="mt-3 text-xs text-accent">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Logging in…" : "Log in"}
          </button>
          <p className="mt-4 text-xs text-muted">
            No account yet?{" "}
            <Link
              to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
              className="text-accent underline"
            >
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
