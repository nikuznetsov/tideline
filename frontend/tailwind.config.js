/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        wide: ["MTS Wide", "system-ui", "sans-serif"],
        compact: ["MTS Compact", "system-ui", "sans-serif"],
      },
      colors: {
        mts: "#E30611",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        surface: "var(--surface)",
        page: "var(--page)",
      },
    },
  },
  plugins: [],
};
