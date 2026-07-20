import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";

function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  const first = parts.shift() ?? "";
  return [first, parts.join(" ")];
}

export function ProfileDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState(() => splitName(user.name)[0]);
  const [lastName, setLastName] = useState(() => splitName(user.name)[1]);
  const [email, setEmail] = useState(user.email);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      await api.patch("/auth/me", { name, email });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["participants"] });
      setProfileMsg({ ok: true, text: "Сохранено" });
    } catch (err) {
      setProfileMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Не удалось сохранить",
      });
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg(null);
    try {
      await api.post("/auth/me/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setPwMsg({ ok: true, text: "Пароль изменён" });
    } catch (err) {
      setPwMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Не удалось изменить пароль",
      });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Профиль"
    >
      <div
        className="max-h-full w-[420px] overflow-auto rounded-lg border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-wide text-sm font-bold">Мой профиль</h2>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Закрыть">
            ✕
          </button>
        </div>

        <form onSubmit={saveProfile} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Имя</span>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Фамилия</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          {profileMsg && (
            <p className={`text-xs ${profileMsg.ok ? "text-muted" : "text-mts"}`}>
              {profileMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={profileBusy}
            className="w-full rounded bg-mts px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {profileBusy ? "Сохраняем…" : "Сохранить"}
          </button>
        </form>

        <hr className="my-5 border-line" />

        <form onSubmit={savePassword} className="space-y-3">
          <h3 className="text-sm font-medium">Смена пароля</h3>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Текущий пароль</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Новый пароль (не короче 8 символов)</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 text-sm"
            />
          </label>
          {pwMsg && (
            <p className={`text-xs ${pwMsg.ok ? "text-muted" : "text-mts"}`}>{pwMsg.text}</p>
          )}
          <button
            type="submit"
            disabled={pwBusy}
            className="w-full rounded border border-line px-3 py-2 text-sm font-medium hover:bg-page disabled:opacity-50"
          >
            {pwBusy ? "Меняем…" : "Изменить пароль"}
          </button>
        </form>
      </div>
    </div>
  );
}
