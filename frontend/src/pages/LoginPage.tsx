import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, ApiError } from "../api/client";

export function LoginPage() {
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
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось войти — проверьте сеть",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-page">
      <form
        onSubmit={submit}
        className="w-[340px] rounded-lg border border-line bg-surface p-6"
      >
        <div className="mb-6">
          <div className="font-wide text-lg font-bold uppercase">xOps</div>
          <div className="font-wide text-lg font-medium text-mts">Tideline</div>
          <p className="mt-2 text-xs text-muted">
            Планирование загрузки команды скользящим окном
          </p>
        </div>
        <label className="mb-3 block">
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
        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-muted">Пароль</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="mb-3 text-xs text-mts">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-mts px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
