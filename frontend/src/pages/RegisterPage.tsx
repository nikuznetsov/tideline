import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";

export function RegisterPage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
      await api.post("/auth/register", {
        first_name: firstName,
        last_name: lastName,
        email,
        password,
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось создать аккаунт",
      );
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
          <h1 className="font-wide text-sm font-bold">Новый аккаунт</h1>
          <p className="mt-1 text-xs text-muted">
            {next?.startsWith("/join/")
              ? "После регистрации вы сразу примете приглашение."
              : "Аккаунт без доступов: вступайте по приглашению или создайте своё пространство."}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Имя</span>
              <input
                required
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Фамилия</span>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-muted">
              Пароль (не короче 8 символов)
            </span>
            <input
              type="password"
              required
              minLength={8}
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
            {busy ? "Создаём…" : "Создать аккаунт"}
          </button>
          <p className="mt-4 text-xs text-muted">
            Уже есть аккаунт?{" "}
            <Link
              to={next ? `/?next=${encodeURIComponent(next)}` : "/"}
              className="text-mts underline"
            >
              Войти
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
