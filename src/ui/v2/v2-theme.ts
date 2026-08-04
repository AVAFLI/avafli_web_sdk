import { MilestoneConfig } from '../../types';
import { V2_FONT_FACES } from './assets.generated';

/**
 * Design system for the V2 experience — tokens, fonts, and ladder math ported
 * 1:1 from the iOS SDK (WINRV2Theme.swift). Everything is intentionally
 * HARDCODED to Joe's Figma design except the publisher-configurable primary
 * color: publishers can customize ONLY their logo, prize image, and primary
 * color.
 */

// ─── Colors (Figma design tokens) ───

export const V2_COLORS = {
  /** background/primary — the drawer + tile background ("gunmetal"). */
  gunmetal: '#1d2330',
  /** black (deep charcoal) — header circle buttons. */
  deepCharcoal: '#0b0d12',
  /** Modal panel background. */
  panel: '#141519',
  /** Modal hairline border. */
  panelBorder: '#515151',
  /** WINR brand blue — the DEFAULT primary when a publisher hasn't set one. */
  winrBlue: '#268fff',

  textSecondary: 'rgba(255,255,255,0.75)',
  textTertiary: 'rgba(255,255,255,0.6)',
  foregroundSecondary: 'rgba(255,255,255,0.5)',
} as const;

/**
 * The publisher's primary color (branding.primaryColor) with the WINR-blue
 * default. Drives: CTA buttons, streak-tile outlines/glow, accent text,
 * power-up tiles.
 */
export function resolveAccent(hex?: string | null): string {
  if (!hex) return V2_COLORS.winrBlue;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return V2_COLORS.winrBlue;
  return `#${h.toLowerCase()}`;
}

/** `rgba()` string for an accent hex at a given alpha (for glows/gradients). */
export function accentAlpha(accentHex: string, alpha: number): string {
  const h = accentHex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Fonts (Inter + Oswald, bundled) ───

export const V2_INTER =
  "'WINR Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const V2_OSWALD = "'WINR Oswald', 'Arial Narrow', Impact, sans-serif";

let fontsInjected = false;

/**
 * Registers the bundled Inter/Oswald faces with the document. Idempotent.
 *
 * NOTE: @font-face rules are ignored inside shadow roots in some engines, so
 * the faces are declared at DOCUMENT level (with WINR-prefixed family names to
 * avoid colliding with a host page's own Inter/Oswald) while all other V2 CSS
 * stays isolated inside the shadow root.
 */
export function ensureV2Fonts(): void {
  if (fontsInjected) return;
  if (typeof document === 'undefined') return;
  fontsInjected = true;
  if (document.getElementById('winr-v2-fonts')) return;

  const css = V2_FONT_FACES.map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};` +
      `font-display:swap;src:url(${f.dataUri}) format('truetype')}`
  ).join('\n');

  const style = document.createElement('style');
  style.id = 'winr-v2-fonts';
  style.textContent = css;
  document.head.appendChild(style);
}

// ─── Ladder math (mirrors the backend exactly) ───

/**
 * Explicit ladder values cover days 1..ladder.length; beyond that the daily
 * increment is the bonusEntries of the LATEST passed milestone (the
 * "+25 EVERY DAY!" accelerators). No milestones → flat at the ladder top.
 */
export function ladderEntries(
  day: number,
  ladder: number[],
  milestones?: MilestoneConfig[] | null
): number {
  if (!ladder || ladder.length === 0) return 10;
  if (day <= ladder.length) return ladder[Math.max(0, day - 1)] ?? 10;
  const ms = [...(milestones ?? [])].sort((a, b) => a.day - b.day);
  let value = ladder[ladder.length - 1] ?? 10;
  for (let d = ladder.length + 1; d <= day; d++) {
    let rate = 0;
    for (const m of ms) {
      if (m.day < d) rate = m.bonusEntries;
    }
    value += rate;
  }
  return value;
}

// ─── Formatting helpers ───

/** "1,000" — matches iOS `Int.formatted()`. */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * "A"/"AN" article for the prize description, keyed off the LEADING token:
 * "$500 Amazon..." reads "a five-hundred...", so any non-letter start takes
 * "a"; only a leading vowel takes "an". (Mirrors iOS.)
 */
export function prizeArticle(description: string, uppercase: boolean): string {
  const first = description.trim().charAt(0);
  const isLetter = /[a-zA-Z]/.test(first);
  const an = isLetter && 'AEIOU'.includes(first.toUpperCase());
  const article = an ? 'an' : 'a';
  return uppercase ? article.toUpperCase() : article;
}

/** Cash prizes render the right-aligned "WIN $1,000 / CASH PRIZE" lockup. */
export function isCashPrize(description: string): boolean {
  return description.trim().length === 0 || description.toLowerCase().includes('cash');
}

/**
 * The value subtitle is redundant when the prize name already states the
 * amount ("$500 Amazon Gift Card"). (Mirrors iOS.)
 */
export function showsValueLine(description: string, value: number): boolean {
  if (value <= 0) return false;
  return (
    !description.includes(`$${formatInt(value)}`) && !description.includes(`$${Math.round(value)}`)
  );
}

/** "August 20, 2026" from "2026-08-20" — falls back to the raw string. */
export function awardedAtDisplay(awardedAt?: string | null): string | null {
  if (!awardedAt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(awardedAt);
  if (!m) return awardedAt;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = months[parseInt(m[2]!, 10) - 1];
  if (!month) return awardedAt;
  return `${month} ${parseInt(m[3]!, 10)}, ${m[1]}`;
}
