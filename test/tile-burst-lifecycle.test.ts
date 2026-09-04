// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { renderDashboard } from '../src/ui/v2/screens';
import { GetActiveGiveawayResponse, Giveaway, AVAFLI_CONSTANTS } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Tile confetti-burst lifecycle (the "where did the explosion go?" report).
 * Day 2+ predicted celebration: the burst GIF must mount on the tile box the
 * moment the auto-reveal fires, survive the background claim's reconcile,
 * and only leave when its own 2s timeout removes it. The root re-render loop
 * is replicated here (wipe + rerender on every onChange) so any stray
 * emission that would destroy the in-place celebration is caught.
 */
const GIVEAWAY: Giveaway = {
  id: 'g1', title: 'Test', prizeDescription: 'Cash', prizeValue: 1000,
  startDate: '2026-01-01T00:00:00Z', endDate: '2027-01-01T00:00:00Z',
  streakLadder: [10, 20, 30, 40, 50, 60], doublingEnabled: false,
  maxDailyBaseEntries: 300, rulesUrl: 'https://example.com/rules', milestones: [],
};
const BUNDLE = 'com.test';
const EMAIL_KEY = `${AVAFLI_CONSTANTS.STORAGE_KEYS.EMAIL_SUBMITTED}_${BUNDLE}`;

function fakeStorage(seed: Record<string, string>): LocalStorageProvider {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function setup() {
  let releaseClaim: () => void = () => {};
  const claimGate = new Promise<void>((r) => { releaseClaim = r; });
  const response: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY, claimedToday: false, streakDay: 2, totalEntries: 10, emailConsentStatus: true,
  } as GetActiveGiveawayResponse;
  const api = {
    getActiveGiveaway: vi.fn(async () => response),
    claimDailyEntries: vi.fn(async () => { await claimGate; return { entries: 20, streakDay: 2, totalEntries: 30 }; }),
  };
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage: fakeStorage({ [EMAIL_KEY]: 'true' }),
    bundleId: BUNDLE,
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => true,
  };
  const controller = new V2ExperienceController(deps);
  const sheet = document.createElement('div');
  document.body.appendChild(sheet);
  let renders = 0;
  // Root behaviour: every state change wipes the sheet and re-renders.
  controller.onChange = (s) => {
    renders++;
    sheet.innerHTML = '';
    if (s.kind === 'dashboard') sheet.appendChild(renderDashboard(controller, null, () => {}));
  };
  return { controller, sheet, releaseClaim, renders: () => renders };
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('tile confetti burst', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('mounts on reveal, survives the background reconcile, leaves after 2s', async () => {
    const { controller, sheet, releaseClaim, renders } = setup();
    await controller.load();
    expect(controller.state.kind).toBe('dashboard');
    expect(sheet.querySelector('.wv2-tile.wv2-ready')).not.toBeNull();
    expect(sheet.querySelector('.wv2-tile-burst')).toBeNull();
    const rendersBeforeReveal = renders();

    // Auto-reveal fires after the mount-settle delay.
    vi.advanceTimersByTime(V2ExperienceController.AUTO_REVEAL_DELAY_MS + 10);
    // Today's tile (not the first/completed one) must now be active.
    expect(sheet.querySelector('.wv2-tile.wv2-active')).not.toBeNull();
    expect(sheet.querySelector('.wv2-tile.wv2-ready')).toBeNull();
    const bursts = sheet.querySelectorAll('.wv2-tile-burst');
    expect(bursts.length).toBe(1);
    const burst = bursts[0] as HTMLElement;
    expect(burst.tagName).toBe('CANVAS');
    expect(burst.parentElement?.classList.contains('wv2-tile-box')).toBe(true);
    expect(sheet.querySelector('.wv2-tile-confetti')).not.toBeNull();

    // Background claim lands → silent reconcile. No re-render, burst intact.
    releaseClaim();
    await flush();
    vi.advanceTimersByTime(100);
    await flush();
    expect(renders()).toBe(rendersBeforeReveal);
    expect(sheet.querySelector('.wv2-tile-burst')).toBe(burst);
    expect(burst.isConnected).toBe(true);

    // The GIF's own timeout removes it; the tile stays celebrated.
    vi.advanceTimersByTime(2000);
    expect(sheet.querySelector('.wv2-tile-burst')).toBeNull();
    expect(sheet.querySelector('.wv2-tile.wv2-active')).not.toBeNull();
  });
});
