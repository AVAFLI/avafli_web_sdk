import { Theme } from '../types';
import { generateCSSVariables } from './theme';

/**
 * Generate all CSS styles for WINR modal — pixel-perfect match to iOS SDK
 */
export function generateModalStyles(theme: Theme): string {
  const cssVariables = generateCSSVariables(theme);

  return `
/* ═══════════════════════════════════════════
   WINR Modal Styles — iOS SDK Parity
   ═══════════════════════════════════════════ */

.winr-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 10000;
  font-family: var(--winr-font-family);
  ${cssVariables}
}

/* ── Modal Container (iOS drawer-style) ── */
.winr-modal {
  background: var(--winr-color-background);
  border-radius: 24px 24px 0 0;
  max-width: 480px;
  width: 100%;
  height: 85vh;
  overflow: hidden;
  position: relative;
  animation: winr-slide-up 0.35s cubic-bezier(0.2, 0.8, 0.3, 1);
}

@keyframes winr-slide-up {
  from { transform: translateY(100%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.winr-modal-exit {
  animation: winr-slide-down 0.25s ease-in forwards;
}

@keyframes winr-slide-down {
  from { transform: translateY(0);    opacity: 1; }
  to   { transform: translateY(100%); opacity: 0; }
}

/* ── Background Layer (ZStack) ── */
.winr-experience-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, var(--winr-color-background) 0%, color-mix(in srgb, var(--winr-color-background) 94%, transparent) 100%);
  z-index: 0;
}

.winr-experience-glow {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 840px;
  height: 840px;
  background: radial-gradient(circle, color-mix(in srgb, var(--winr-glow) 35%, transparent) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
}

/* ── Header Overlay (iOS: .overlay at top) ── */
.winr-header-overlay {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px;
  z-index: 100;
}

.winr-header-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--winr-card-bg) 90%, transparent);
  border: 1px solid var(--winr-card-border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--winr-color-text);
  font-size: 14px;
  font-weight: 700;
  transition: background 0.15s;
  padding: 0;
  line-height: 1;
  -webkit-appearance: none;
  appearance: none;
}

.winr-header-icon:hover {
  background: var(--winr-card-bg);
}

.winr-header-spacer {
  width: 28px;
  height: 28px;
}

/* ── Content wrapper ── */
.winr-modal-content {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 1;
}

.winr-experience-screen {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 50px;
}

/* ═══════════════════════════════════════════
   Email Capture — match EmailCaptureView.swift
   ═══════════════════════════════════════════ */

.winr-email-capture {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2px 0 0 0;
  gap: 20px;
}

.winr-email-logo {
  margin-bottom: 40px;
}

.winr-email-logo img {
  max-width: 200px;
  max-height: 80px;
  object-fit: contain;
}

.winr-email-titles {
  text-align: center;
  padding-top: 8px;
}

.winr-email-titles h2 {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.5px;
  color: var(--winr-color-secondary);
  margin: 0 0 10px 0;
}

.winr-email-titles p {
  font-size: 15px;
  font-weight: 500;
  color: var(--winr-muted);
  margin: 0;
  line-height: 1.5;
}

/* Email field group */
.winr-email-field-group {
  width: 100%;
  padding: 0 20px;
  box-sizing: border-box;
}

.winr-email-field-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(224,224,224,0.9);
  margin-bottom: 6px;
  display: block;
}

.winr-email-input-wrapper {
  position: relative;
  background: var(--winr-input-bg);
  border: 1px solid var(--winr-input-border);
  border-radius: 16px;
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  box-shadow: 0 10px 14px rgba(0,0,0,0.5);
  transition: border-color 0.2s;
}

.winr-email-input-wrapper.error {
  border-color: rgba(239,68,68,0.6);
}

.winr-email-input-wrapper .winr-envelope-icon {
  color: var(--winr-input-placeholder);
  font-size: 15px;
  margin-right: 10px;
  flex-shrink: 0;
}

.winr-email-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 15px;
  font-weight: 500;
  color: var(--winr-color-text);
  font-family: var(--winr-font-family);
}

.winr-email-input::placeholder {
  color: var(--winr-input-placeholder);
  font-weight: 500;
}

.winr-email-error {
  font-size: 12px;
  font-weight: 500;
  color: rgba(239,68,68,0.9);
  padding-left: 4px;
  margin-top: 6px;
  display: none;
}

/* Age gate checkbox */
.winr-age-gate {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 0 20px;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}

.winr-age-gate-icon {
  font-size: 20px;
  flex-shrink: 0;
  line-height: 1;
}

.winr-age-gate-text {
  font-size: 13px;
  font-weight: 500;
  color: rgba(224,224,224,0.85);
  line-height: 1.4;
}

/* CTA button */
.winr-enter-button {
  width: calc(100% - 40px);
  margin: 6px 20px 0 20px;
  padding: 14px 0;
  border: none;
  border-radius: 22px;
  font-size: 17px;
  font-weight: 600;
  color: var(--winr-btn-text);
  background: var(--winr-btn-color);
  cursor: pointer;
  transition: opacity 0.2s, box-shadow 0.2s;
  font-family: var(--winr-font-family);
}

.winr-enter-button.active {
  box-shadow: 0 12px 16px color-mix(in srgb, var(--winr-glow) 50%, transparent);
}

.winr-enter-button.inactive {
  opacity: 0.4;
}

/* Legal links */
.winr-legal-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  padding-top: 2px;
  font-size: 11px;
}

.winr-legal-links span {
  color: rgba(160,160,176,0.7);
}

.winr-legal-links a {
  color: var(--winr-btn-color);
  font-weight: 600;
  text-decoration: none;
}

/* ═══════════════════════════════════════════
   Streak Dashboard — match StreakDashboardView.swift
   ═══════════════════════════════════════════ */

.winr-streak-dashboard {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100%;
}

.winr-streak-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 14px;
  padding-bottom: 160px;
}

/* Hero logo + prize */
.winr-streak-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 20px;
}

.winr-streak-hero-logo {
  max-width: 75%;
  max-height: 22vh;
  object-fit: contain;
  filter: drop-shadow(0 4px 12px color-mix(in srgb, var(--winr-glow) 50%, transparent));
}

.winr-streak-prize-banner {
  text-align: center;
  margin-top: 14px;
}

.winr-streak-prize-title {
  font-size: 22px;
  font-weight: 900;
  color: var(--winr-color-text);
  text-shadow: 0 4px 8px color-mix(in srgb, var(--winr-glow) 80%, transparent);
  margin: 0;
  font-family: var(--winr-font-family);
}

.winr-streak-prize-subtitle {
  font-size: 12px;
  font-weight: 500;
  color: var(--winr-muted);
  margin: 4px 0 0 0;
  text-align: center;
}

/* Streak tiles carousel */
.winr-streak-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--winr-color-secondary);
  padding-left: 6px;
  margin: 14px 0 8px 0;
}

.winr-streak-carousel {
  padding: 16px 6px 4px;
}

/* 7 day-tiles laid out as a 4 + 3 grid (matches the native iOS/Android dashboards),
   not a horizontal scroller. */
.winr-streak-tiles-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

/* Bonus progress pills */
.winr-bonus-progress-section {
  padding: 0 6px;
  margin-top: 14px;
}

.winr-bonus-progress-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--winr-color-secondary);
  margin: 0 0 10px 0;
}

.winr-bonus-progress-row {
  display: flex;
  gap: 10px;
}

.winr-bonus-pill {
  flex: 1;
  padding: 10px;
  background: color-mix(in srgb, var(--winr-card-bg) 50%, transparent);
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--winr-glow) 25%, transparent);
}

.winr-bonus-pill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.winr-bonus-pill-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--winr-muted);
}

.winr-bonus-pill-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--winr-color-secondary);
}

.winr-bonus-pill-bar {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  overflow: hidden;
}

.winr-bonus-pill-fill {
  height: 100%;
  background: var(--winr-glow);
  border-radius: 3px;
  transition: width 0.4s ease;
}

.winr-bonus-pill-footer {
  font-size: 10px;
  font-weight: 500;
  margin-top: 6px;
}

.winr-bonus-pill-footer.earned {
  color: var(--winr-glow);
}

.winr-bonus-pill-footer.pending {
  color: var(--winr-muted);
}

/* Sticky footer */
.winr-streak-footer {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 0 14px 16px 14px;
  text-align: center;
  z-index: 10;
  background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--winr-color-background) 96%, transparent) 40%);
}

.winr-streak-footer-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--winr-color-secondary);
  margin: 0 0 4px 0;
}

.winr-streak-footer-desc {
  font-size: 12px;
  font-weight: 500;
  color: var(--winr-muted);
  margin: 0 0 8px 0;
}

.winr-claim-button {
  width: calc(100% - 8px);
  margin: 2px 4px 0 4px;
  padding: 14px 0;
  border: none;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 600;
  color: var(--winr-btn-text);
  background: var(--winr-btn-color);
  cursor: pointer;
  font-family: var(--winr-font-family);
  box-shadow: 0 8px 14px color-mix(in srgb, var(--winr-glow) 60%, transparent);
  transition: transform 0.15s;
}

.winr-claim-button:active { transform: scale(0.97); }
.winr-claim-button:disabled, .winr-claim-button.is-loading {
  opacity: 0.7;
  cursor: default;
}
.winr-btn-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-right: 8px;
  vertical-align: -3px;
  border: 2px solid color-mix(in srgb, var(--winr-btn-text) 40%, transparent);
  border-top-color: var(--winr-btn-text);
  border-radius: 50%;
  animation: winr-spin 0.7s linear infinite;
}

.winr-reward-pill {
  display: inline-block;
  margin: 6px auto 2px;
  padding: 5px 14px;
  border-radius: 9999px;
  border: 1px solid var(--winr-card-border);
  background: color-mix(in srgb, var(--winr-card-bg) 70%, transparent);
  color: var(--winr-color-text);
  font-size: 14px;
  font-family: var(--winr-font-family);
}
.winr-reward-pill .winr-reward-arrow { color: var(--winr-btn-color); margin: 0 2px; }

.winr-claimed-icon {
  font-size: 28px;
  color: var(--winr-glow);
  margin-bottom: 6px;
}

.winr-done-button {
  width: calc(100% - 8px);
  margin: 2px 4px 0 4px;
  padding: 14px 0;
  border: 1px solid color-mix(in srgb, var(--winr-glow) 40%, transparent);
  border-radius: 16px;
  font-size: 17px;
  font-weight: 600;
  color: var(--winr-color-secondary);
  background: color-mix(in srgb, var(--winr-card-bg) 80%, transparent);
  cursor: pointer;
  font-family: var(--winr-font-family);
}

/* ═══════════════════════════════════════════
   Streak Day Tile — match CompactStreakTile
   ═══════════════════════════════════════════ */

.winr-tile {
  width: 100%;
  aspect-ratio: 5 / 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 16px;
  box-sizing: border-box;
  position: relative;
  transition: transform 0.2s;
}

/* Tile states */
.winr-tile.is-today {
  background: linear-gradient(135deg, var(--winr-btn-color), color-mix(in srgb, var(--winr-card-bg) 90%, transparent));
  border: 2px solid var(--winr-glow);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--winr-glow) 70%, transparent);
  transform: scale(1.05);
}

.winr-tile.is-claimed {
  background: linear-gradient(180deg, rgba(255,255,255,0.2), color-mix(in srgb, var(--winr-card-bg) 90%, transparent));
  border: 1px solid rgba(255,255,255,0.6);
}

.winr-tile.is-locked {
  background: linear-gradient(180deg, color-mix(in srgb, var(--winr-card-bg) 45%, transparent), color-mix(in srgb, var(--winr-card-bg) 30%, transparent));
  border: 1px solid rgba(255,255,255,0.15);
}

/* Day pill */
.winr-tile-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 9999px;
  position: relative;
}

.winr-tile.is-today .winr-tile-pill {
  background: color-mix(in srgb, var(--winr-card-bg) 95%, transparent);
  color: var(--winr-btn-text);
}

.winr-tile.is-claimed .winr-tile-pill {
  background: rgba(255,255,255,0.35);
  color: var(--winr-color-secondary);
}

.winr-tile.is-locked .winr-tile-pill {
  background: color-mix(in srgb, var(--winr-card-bg) 85%, transparent);
  color: var(--winr-color-secondary);
}

/* Pulse ring on today pill */
.winr-tile.is-today .winr-tile-pill::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 9999px;
  border: 1.5px solid var(--winr-glow);
  animation: winr-pill-pulse 1.4s ease-in-out infinite;
}

@keyframes winr-pill-pulse {
  0%   { transform: scale(1);    opacity: 1;   }
  100% { transform: scale(1.12); opacity: 0.4; }
}

/* Entries number */
.winr-tile-entries {
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.winr-tile.is-today .winr-tile-entries  { color: var(--winr-color-text); }
.winr-tile.is-claimed .winr-tile-entries { color: var(--winr-color-text); }
.winr-tile.is-locked .winr-tile-entries  { color: rgba(160,160,176,0.85); }

/* Entries label */
.winr-tile-label {
  font-size: 10px;
  font-weight: 500;
}

.winr-tile.is-today .winr-tile-label  { color: rgba(255,255,255,0.85); }
.winr-tile.is-claimed .winr-tile-label { color: rgba(255,255,255,0.8); }
.winr-tile.is-locked .winr-tile-label  { color: rgba(160,160,176,0.6); }

/* Status icon */
.winr-tile-icon {
  font-size: 16px;
  line-height: 1;
}

.winr-tile.is-today .winr-tile-icon {
  text-shadow: 0 0 6px var(--winr-glow);
}

/* ═══════════════════════════════════════════
   Bonus Entries — match BonusEntriesView.swift
   ═══════════════════════════════════════════ */

.winr-bonus-entries {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 50px 24px 24px 24px;
  gap: 20px;
}

.winr-bonus-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--winr-color-text);
  margin: 0;
}

.winr-bonus-desc {
  font-size: 16px;
  color: rgba(255,255,255,0.9);
  text-align: center;
  margin: 0;
  line-height: 1.5;
}

.winr-bonus-claim-btn {
  width: 100%;
  padding: 16px;
  border: none;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 600;
  color: var(--winr-color-background);
  background: var(--winr-color-text);
  cursor: pointer;
  font-family: var(--winr-font-family);
  transition: transform 0.15s;
}

.winr-bonus-claim-btn:active { transform: scale(0.97); }

.winr-bonus-skip {
  font-size: 14px;
  color: rgba(255,255,255,0.7);
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--winr-font-family);
}

/* ═══════════════════════════════════════════
   How It Works — match HowItWorksView.swift
   ═══════════════════════════════════════════ */

.winr-how-it-works {
  position: relative;
  height: 100%;
}

.winr-how-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 0 24px 140px 24px;
}

.winr-how-hero {
  text-align: center;
  padding-top: 4px;
  margin-bottom: 28px;
}

.winr-how-hero-emoji {
  font-size: 48px;
  margin-bottom: 10px;
}

.winr-how-hero-title {
  font-size: 24px;
  font-weight: 900;
  color: var(--winr-color-text);
  margin: 0 0 10px 0;
}

.winr-how-hero-desc {
  font-size: 14px;
  font-weight: 500;
  color: var(--winr-muted);
  margin: 0;
}

/* Step rows */
.winr-how-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 28px;
}

.winr-how-step {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px;
  background: color-mix(in srgb, var(--winr-card-bg) 50%, transparent);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.06);
}

.winr-how-step-number {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--winr-btn-color), rgba(91,76,255,0.7));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 900;
  color: var(--winr-btn-text);
  flex-shrink: 0;
}

.winr-how-step-body {
  flex: 1;
  min-width: 0;
}

.winr-how-step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.winr-how-step-icon {
  font-size: 14px;
  color: var(--winr-glow);
}

.winr-how-step-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--winr-color-text);
  margin: 0;
}

.winr-how-step-desc {
  font-size: 13px;
  font-weight: 500;
  color: var(--winr-muted);
  margin: 0;
  line-height: 1.5;
}

/* Pro tip card */
.winr-how-tip {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: rgba(91,76,255,0.08);
  border-radius: 16px;
  border: 1px solid rgba(91,76,255,0.2);
}

.winr-how-tip-icon {
  font-size: 20px;
  color: var(--winr-btn-color);
  flex-shrink: 0;
}

.winr-how-tip-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--winr-muted);
  line-height: 1.5;
  margin: 0;
}

/* Sticky CTA */
.winr-how-footer {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 0 24px 20px 24px;
  background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--winr-color-background) 96%, transparent) 40%);
  z-index: 10;
}

.winr-how-gotit-btn {
  width: 100%;
  padding: 14px 0;
  border: none;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 600;
  color: var(--winr-btn-text);
  background: var(--winr-btn-color);
  cursor: pointer;
  font-family: var(--winr-font-family);
  box-shadow: 0 8px 14px color-mix(in srgb, var(--winr-glow) 50%, transparent);
}

/* ═══════════════════════════════════════════
   Loading / Completed / Error states
   ═══════════════════════════════════════════ */

.winr-loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  min-height: 300px;
}

.winr-loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid color-mix(in srgb, var(--winr-glow) 20%, transparent);
  border-top-color: var(--winr-glow);
  border-radius: 50%;
  animation: winr-spin 0.8s linear infinite;
}

@keyframes winr-spin {
  to { transform: rotate(360deg); }
}

.winr-loading-text {
  font-size: 15px;
  color: var(--winr-color-text);
}

.winr-card-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 50px 24px;
  text-align: center;
}

.winr-card-state h2 {
  font-size: 22px;
  font-weight: 900;
  color: var(--winr-color-text);
  margin: 0;
}

.winr-card-state p {
  font-size: 15px;
  color: var(--winr-muted);
  margin: 0;
}

.winr-card-state button {
  width: 100%;
  padding: 14px 0;
  border: none;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 600;
  color: var(--winr-btn-text);
  background: var(--winr-btn-color);
  cursor: pointer;
  font-family: var(--winr-font-family);
}

/* ═══════════════════════════════════════════
   Utility animations
   ═══════════════════════════════════════════ */

@keyframes winr-bounce-in {
  0%   { transform: scale(0.8); opacity: 0; }
  60%  { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .winr-modal, .winr-tile, .winr-loading-spinner,
  .winr-tile.is-today .winr-tile-pill::after {
    animation: none !important;
  }
  .winr-tile.is-today { transform: none; }
}

/* Responsive */
@media (max-width: 380px) {
  .winr-tile-entries { font-size: 18px; }
}
`;
}

/**
 * Inject styles into document head
 */
export function injectStyles(theme: Theme): () => void {
  const styleId = 'winr-modal-styles';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) existingStyle.remove();

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = generateModalStyles(theme);
  document.head.appendChild(style);

  return () => {
    const element = document.getElementById(styleId);
    if (element) element.remove();
  };
}
