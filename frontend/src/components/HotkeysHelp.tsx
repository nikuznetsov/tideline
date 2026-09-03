const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Cell input",
    keys: [
      ["1", "Full day"],
      ["5", "Half day"],
      ["7", "Most of the day"],
      ["2", "Background"],
      ["0 / Delete", "Clear"],
      ["Enter / double-click", "Pick a category"],
    ],
  },
  {
    title: "Navigation",
    keys: [
      ["← ↑ → ↓", "Move between cells"],
      ["Tab", "Move right"],
      ["Shift + arrows", "Select a range"],
      ["Esc", "Clear selection"],
    ],
  },
  {
    title: "Actions",
    keys: [
      ["Cmd/Ctrl + Z", "Undo"],
      ["Cmd/Ctrl + Shift + Z", "Redo"],
      ["?", "This help"],
    ],
  },
];

export function HotkeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-[420px] rounded-lg border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold">Keyboard shortcuts</h2>
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
