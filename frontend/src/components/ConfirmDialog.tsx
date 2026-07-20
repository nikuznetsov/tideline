import { ReactNode, useEffect, useState } from "react";

/** Стилизованная замена window.confirm для необратимых действий. */
export function ConfirmDialog({
  title = "Подтвердите действие",
  message,
  confirmLabel = "Подтвердить",
  verifyText,
  onConfirm,
  onClose,
}: {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  /** особо опасные действия: кнопка активна, только когда введён этот текст */
  verifyText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const blocked = !!verifyText && typed !== verifyText;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-label={title}
    >
      <div
        className="w-[380px] rounded-lg border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-wide text-sm font-bold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{message}</div>
        {verifyText && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-muted">
              Введите <b className="font-nums">{verifyText}</b>, чтобы подтвердить
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded border border-line bg-page px-3 py-2 font-nums text-sm"
            />
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-line px-3 py-1.5 text-xs font-medium hover:bg-page"
          >
            Отмена
          </button>
          <button
            autoFocus={!verifyText}
            disabled={blocked}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="rounded bg-mts px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
