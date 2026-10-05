"use client";

import { useState } from "react";
import { SegmentedToggle } from "@/app/components/ui";
import {
  ACCENTS,
  DARK_FROM,
  applyTheme,
  loadTheme,
  saveTheme,
  type AccentId,
  type Theme,
  type ThemeMode,
} from "@/app/lib/theme";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Lets the signed-in user pick light/dark, fine-tune the background
 *  brightness, and choose an accent colour. Remembered in this browser. */
export function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  function update(next: Theme) {
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  }

  // Where the slider sits when no custom level is set: the current preset.
  const presetLevel =
    theme.mode === "dark" ? 100 : theme.mode === "light" ? 0 : window.matchMedia("(prefers-color-scheme: dark)").matches ? 100 : 0;
  const level = theme.level ?? presetLevel;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-foreground-muted">Appearance</p>
      <SegmentedToggle
        name="theme-mode"
        options={MODES}
        // A custom brightness isn't any of the presets, so none is highlighted.
        value={(theme.level === null ? theme.mode : "") as ThemeMode}
        onChange={(mode) => update({ ...theme, mode, level: null })}
      />

      <label className="flex flex-col gap-1 text-xs text-foreground-muted">
        <span className="flex items-center justify-between">
          <span>Background brightness</span>
          <span className="tabular-nums">{level >= DARK_FROM ? "Dark" : "Light"} · {level}%</span>
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden>☀</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={level}
            aria-label="Background brightness, light to dark"
            onChange={(e) => update({ ...theme, level: Number(e.target.value) })}
            className="h-1.5 w-full cursor-pointer accent-[var(--primary)]"
          />
          <span aria-hidden>☾</span>
        </span>
      </label>

      <div className="flex items-center gap-2" role="radiogroup" aria-label="Accent colour">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={theme.accent === a.id}
            aria-label={a.label}
            title={a.label}
            onClick={() => update({ ...theme, accent: a.id as AccentId })}
            style={{ backgroundColor: a.color }}
            className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
              theme.accent === a.id ? "border-foreground" : "border-transparent"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
