import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";

const FEATURES: [string, string][] = [
  [
    "Таймлайн на две недели",
    "Сетка «люди × дни» с вводом только с клавиатуры: 1, 5, 2, 7 — и загрузка проставлена. Быстрее, чем таблица.",
  ],
  [
    "Хватит ли людей?",
    "Диапазон дат и объём в днях — сервис отвечает вердиктом и списком кандидатов с предупреждениями про отпуска и bus factor.",
  ],
  [
    "План против факта",
    "Закрытие недели фиксирует снимок. Экран точности показывает, где план разошёлся с реальностью.",
  ],
  [
    "Ссылка для менеджмента",
    "Read-only ссылка без логина: текущая картина загрузки и проектов, ничего нельзя сломать.",
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
      // App перерисуется как авторизованный и уведёт на next / пространство
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти — проверьте сеть");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full overflow-auto bg-page">
      <header className="mx-auto flex max-w-5xl items-baseline gap-2 px-6 pt-6">
        <span className="font-wide text-base font-bold uppercase tracking-wide">xOps</span>
        <span className="font-wide text-base font-medium text-mts">Tideline</span>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[1fr_360px]">
        <section>
          <h1 className="max-w-xl font-wide text-3xl font-bold leading-tight">
            Кто чем занят — и хватит ли людей на следующий проект
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            Tideline планирует загрузку команды скользящим окном в две недели:
            линия прилива сдвигается каждую неделю и оставляет точный след —
            что было планом, а что стало фактом.
          </p>

          {/* линия прилива — фирменный разделитель */}
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
          <h2 className="font-wide text-sm font-bold">Вход</h2>
          {next?.startsWith("/join/") && (
            <p className="mt-1 text-xs text-muted">
              Войдите или создайте аккаунт, чтобы принять приглашение.
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
              <span className="mb-1 block text-xs text-muted">Пароль</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="text-xs text-mts">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-mts px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Вход…" : "Войти"}
            </button>
          </form>
          <p className="mt-4 text-xs text-muted">
            Нет аккаунта?{" "}
            <Link
              to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
              className="text-mts underline"
            >
              Создать
            </Link>{" "}
            — и завести своё пространство.
          </p>
        </aside>
      </main>

      <footer className="mx-auto max-w-5xl px-6 pb-8 text-[11px] text-muted">
        Доступ в пространства — только по приглашению. Публичного каталога нет.
      </footer>
    </div>
  );
}
