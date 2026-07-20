import { useQueryClient } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { User } from "../api/types";
import { useWorkspace } from "../workspace";
import { HotkeysHelp } from "./HotkeysHelp";

export function Layout({ user, children }: { user: User; children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { current, workspaces, wsPath } = useWorkspace();

  const nav = [
    { to: wsPath("/"), label: "Таймлайн", end: true },
    { to: wsPath("/projects"), label: "Проекты", end: false },
    { to: wsPath("/team"), label: "Команда", end: false },
    { to: wsPath("/accuracy"), label: "Точность", end: false },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function logout() {
    await api.post("/auth/logout");
    queryClient.clear();
    navigate("/");
    window.location.reload();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-line bg-surface px-4 py-2">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-wide text-sm font-bold uppercase tracking-wide">
            xOps
          </span>
          <span className="font-wide text-sm font-medium text-mts">Tideline</span>
        </Link>

        {/* переключатель пространств */}
        <select
          value={current.slug}
          onChange={(e) => {
            if (e.target.value === "__all__") navigate("/workspaces");
            else navigate(`/w/${e.target.value}/`);
          }}
          className="max-w-44 truncate rounded border border-line bg-page px-2 py-1 text-xs"
          title="Пространство"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.slug}>
              {w.name}
            </option>
          ))}
          <option value="__all__">Все пространства…</option>
        </select>

        <nav className="flex gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded px-3 py-1.5 text-sm ${
                  isActive
                    ? "bg-page font-medium text-ink"
                    : "text-muted hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setHelpOpen(true)}
            className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-ink"
            title="Горячие клавиши (?)"
          >
            ?
          </button>
          <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
          <button
            onClick={logout}
            className="text-xs text-muted underline hover:text-ink"
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      {helpOpen && <HotkeysHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
