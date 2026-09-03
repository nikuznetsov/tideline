import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { Wordmark } from "../components/Wordmark";

const FEATURES: [string, string][] = [
  [
    "A two-week timeline",
    "A people × days grid driven entirely from the keyboard: 1, 5, 2, 7 — and the load is set. Faster than a spreadsheet.",
  ],
  [
    "Enough people?",
    "Give it a date range and an amount in days — Tideline answers with a verdict and a list of candidates, flagging vacations and fragmented time.",
  ],
  [
    "Plan vs. actual",
    "Closing a week captures a snapshot. The Accuracy view shows where the plan drifted from reality.",
  ],
  [
    "A link for management",
    "A read-only link with no login: the current picture of load and projects, with nothing to break.",
  ],
];

export function LandingPage() {
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
    <div className="min-h-full overflow-auto bg-page">
      <header className="mx-auto flex max-w-5xl items-baseline gap-2 px-6 pt-6">
        <Wordmark size="base" />
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[1fr_360px]">
        <section>
          <h1 className="max-w-xl font-display text-3xl font-bold leading-tight">
            Who is working on what — and whether you have enough people for the next project
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            Tideline plans your team's load in a rolling two-week window: the
            tide line moves forward every week and leaves an exact trace of
            what was planned and what actually happened.
          </p>

          {/* tide line — the signature divider */}
          <div
            className="my-8 h-[3px] max-w-xl"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--accent) 0 10px, transparent 10px 16px)",
              opacity: 0.7,
            }}
            aria-hidden
          />

          <dl className="grid max-w-xl gap-5 sm:grid-cols-2">
            {FEATURES.map(([title, text]) => (
              <div key={title}>
                <dt className="text-sm font-medium">{title}</dt>
                <dd className="mt-1 text-xs leading-relaxed text-muted">{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="h-fit rounded-lg border border-line bg-surface p-6">
          <h2 className="font-display text-sm font-bold">Log in</h2>
          {next?.startsWith("/join/") && (
            <p className="mt-1 text-xs text-muted">
              Log in or create an account to accept the invitation.
            </p>
          )}
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block">
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
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="text-xs text-accent">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>
          <p className="mt-4 text-xs text-muted">
            No account yet?{" "}
            <Link
              to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
              className="text-accent underline"
            >
              Create one
            </Link>{" "}
            — and set up your own workspace.
          </p>
        </aside>
      </main>

      <footer className="mx-auto max-w-5xl px-6 pb-8 text-[11px] text-muted">
        Workspaces are invite-only. There is no public directory.
      </footer>
    </div>
  );
}
