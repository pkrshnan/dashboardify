// Apple dark-mode system colours, as listed in docs/design/README.md. The same values are CSS
// variables in styles.css; these copies are for colours computed in code (alpha fills, charts).
// Status colours carry meaning and are never used for categories.

import type { Category, HealthGroup, Tone } from "../../src/home/types";

export const TEXT = "#F5F5F7";
export const TEXT_2 = "#A1A1A6";
export const TEXT_3 = "#8E8E93";

export const STATUS = {
  good: "#30D158",
  caution: "#FFD60A",
  bad: "#FF453A",
  warn: "#FF9F0A",
};

export const CATEGORY: Record<Category, string> = {
  work: "#0A84FF",
  fitness: "#40C8E0",
  personal: "#BF5AF2",
  relationships: "#FF375F",
  family: "#5E5CE6",
  focus: "#8E8E93",
};

export const HEALTH: Record<HealthGroup, string> = {
  heart: "#FF7EB6",
  sleep: "#7D7AFF",
  activity: "#64D2FF",
  vitals: "#AC8E68",
};

export function toneColor(tone: Tone): string {
  if (tone === "good") {
    return STATUS.good;
  }
  return tone === "bad" ? STATUS.bad : TEXT_3;
}

/** Recovery 67–100 green, 34–66 yellow, 0–33 red. */
export function recoveryColor(pct: number): string {
  if (pct >= 67) {
    return STATUS.good;
  }
  return pct >= 34 ? STATUS.caution : STATUS.bad;
}

/** A hex colour with an alpha byte, e.g. alpha("#0A84FF", 0.15). */
export function alpha(hex: string, amount: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, amount)) * 255);
  return `${hex}${byte.toString(16).padStart(2, "0").toUpperCase()}`;
}
