import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";

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
      // App перерисуется как авторизованный и уведёт на next / пространство
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти — проверьте сеть");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center overflow-auto bg-page py-8">
      <div className="w-[380px]">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-wide text-base font-bold uppercase">xOps</span>
          <span className="font-wide text-base font-medium text-mts">Tideline</span>
        </div>
        <form
          onSubmit={submit}
          className="rounded-lg border border-line bg-surface p-6"
        >
          <h1 className="font-wide text-sm font-bold">Вход</h1>
          {next?.startsWith("/join/") && (
            <p className="mt-1 text-xs text-muted">
              После входа вы вернётесь к приглашению.
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
            <span className="mb-1 block text-xs text-muted">Пароль</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          {error && <p className="mt-3 text-xs text-mts">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded bg-mts px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Вход…" : "Войти"}
          </button>
          <p className="mt-4 text-xs text-muted">
            Нет аккаунта?{" "}
            <Link
              to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
              className="text-mts underline"
            >
              Создать
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
