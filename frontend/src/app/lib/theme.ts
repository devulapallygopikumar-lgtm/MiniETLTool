// Per-browser colour theme: a mode (follow the OS, or force light/dark), an
// optional brightness level that overrides the mode, and an accent colour.
// Applied as data-mode / data-level / data-accent on <html>, which
// globals.css turns into the colour variables. The layout runs
// THEME_BOOT_SCRIPT before first paint so a saved choice never flashes the
// default.

export type ThemeMode = "system" | "light" | "dark";
export type AccentId = "orange" | "blue" | "teal" | "purple" | "rose" | "slate";

export interface Theme {
  mode: ThemeMode;
  /** 0 (lightest) .. 100 (darkest) background brightness; null = use `mode`. */
  level: number | null;
  accent: AccentId;
}

export const DEFAULT_THEME: Theme = { mode: "system", level: null, accent: "orange" };
export const THEME_KEY = "datamigrationtool.theme";

// At or above this level the background is dark enough to need light text.
export const DARK_FROM = 60;

// Swatch colours only -- the real values live in globals.css.
export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: "orange", label: "Orange", color: "#c2410c" },
  { id: "blue", label: "Blue", color: "#2563eb" },
  { id: "teal", label: "Teal", color: "#0d9488" },
  { id: "purple", label: "Purple", color: "#7c3aed" },
  { id: "rose", label: "Rose", color: "#e11d48" },
  { id: "slate", label: "Slate", color: "#64748b" },
];

export function loadTheme(): Theme {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_KEY) ?? "null");
    const mode: ThemeMode = ["system", "light", "dark"].includes(raw?.mode) ? raw.mode : DEFAULT_THEME.mode;
    const accent: AccentId = ACCENTS.some((a) => a.id === raw?.accent) ? raw.accent : DEFAULT_THEME.accent;
    const level = typeof raw?.level === "number" ? Math.min(100, Math.max(0, raw.level)) : null;
    return { mode, level, accent };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme.level !== null) {
    root.setAttribute("data-level", "1");
    root.style.setProperty("--lvl", String(theme.level));
    root.setAttribute("data-mode", theme.level >= DARK_FROM ? "dark" : "light");
  } else {
    root.removeAttribute("data-level");
    root.style.removeProperty("--lvl");
    if (theme.mode === "system") root.removeAttribute("data-mode");
    else root.setAttribute("data-mode", theme.mode);
  }
  if (theme.accent === "orange") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", theme.accent);
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  } catch {}
}

// Same logic as loadTheme + applyTheme, as a string for an inline <script>.
export const THEME_BOOT_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_KEY
)})||"null");if(!t)return;var r=document.documentElement;if(typeof t.level==="number"){var l=Math.min(100,Math.max(0,t.level));r.setAttribute("data-level","1");r.style.setProperty("--lvl",String(l));r.setAttribute("data-mode",l>=${DARK_FROM}?"dark":"light")}else if(t.mode==="light"||t.mode==="dark")r.setAttribute("data-mode",t.mode);if(t.accent&&t.accent!=="orange")r.setAttribute("data-accent",t.accent)}catch(e){}})()`;
