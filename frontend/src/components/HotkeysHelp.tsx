const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Ввод в ячейке",
    keys: [
      ["1", "Весь день"],
      ["5", "Наполовину"],
      ["7", "Почти весь день"],
      ["2", "Фоново"],
      ["0 / Delete", "Очистить"],
      ["Enter / двойной клик", "Выбор категории"],
    ],
  },
  {
    title: "Навигация",
    keys: [
      ["← ↑ → ↓", "Между ячейками"],
      ["Tab", "Вправо"],
      ["Shift + стрелки", "Выделить диапазон"],
      ["Esc", "Сбросить выделение"],
    ],
  },
  {
    title: "Действия",
    keys: [
      ["Cmd/Ctrl + Z", "Отменить"],
      ["Cmd/Ctrl + Shift + Z", "Вернуть"],
      ["?", "Эта справка"],
    ],
  },
];

export function HotkeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-label="Горячие клавиши"
    >
      <div
        className="w-[420px] rounded-lg border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-wide text-sm font-bold">Горячие клавиши</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {g.title}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {g.keys.map(([k, desc]) => (
                  <tr key={k}>
                    <td className="w-40 py-0.5">
                      <kbd className="rounded border border-line bg-page px-1.5 py-0.5 text-xs">
                        {k}
                      </kbd>
                    </td>
                    <td className="py-0.5 text-muted">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
