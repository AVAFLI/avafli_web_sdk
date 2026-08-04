// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { COMEBACK_TOAST_HOLD_MS, renderDashboard } from '../src/ui/v2/screens';
import { TILE_BURST_DURATION_MS } from '../src/ui/v2/effects';
import { V2_IMAGES } from '../src/ui/v2/assets.generated';
import {
  ClaimDailyEntriesResponse,
  GetActiveGiveawayResponse,
  Giveaway,
} from '../src/types';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Day 2+ reveal flow (parity with iOS commit 50cd438 — Joe's Slice prototype).
 *
 * The auto-claim on open grants entries server-side immediately, but:
 *  - streakDay <= 1 → the "You're in!" celebration modal is the reveal.
 *  - streakDay >= 2 → NO modal and NO claim click. The controller lands on
 *    the dashboard with a pending reveal grant (UI pins yesterday's numbers:
 *    streak label N-1, pre-claim total), then the celebration fires ON ITS
 *    OWN ~800ms after the claim response is staged. The pill reads GOT IT
 *    the whole time and only dismisses.
 *  - "Already claimed" (cross-device) and silent auto-claim failures are
 *    unchanged: plain dashboard, no pending reveal, no timer.
 */

const GIVEAWAY: Giveaway = {
  id: 'g1',
  title: 'Test Giveaway',
  prizeDescription: 'Cash Prize',
  prizeValue: 1000,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2027-01-01T00:00:00Z',
  streakLadder: [10, 30, 60, 130, 240, 300],
  doublingEnabled: false,
  maxDailyBaseEntries: 300,
  rulesUrl: 'https://example.com/rules',
  milestones: [],
};

const DELAY = V2ExperienceController.AUTO_REVEAL_DELAY_MS;

function fakeStorage(seed: Record<string, string> = {}): LocalStorageProvider {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function makeController(options: {
  giveawayResponse?: Partial<GetActiveGiveawayResponse>;
  claim?: Partial<ClaimDailyEntriesResponse>;
  claimError?: Error;
}): { controller: V2ExperienceController; api: { getActiveGiveaway: ReturnType<typeof vi.fn> } } {
  const giveawayResponse: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY,
    claimedToday: false,
    streakDay: 1,
    totalEntries: 0,
    emailConsentStatus: true,
    ...options.giveawayResponse,
  };
  const api = {
    getActiveGiveaway: vi.fn(async () => giveawayResponse),
    claimDailyEntries: vi.fn(async () => {
      if (options.claimError) throw options.claimError;
      return {
        entries: 10,
        streakDay: 1,
        totalEntries: 10,
        ...options.claim,
      } as ClaimDailyEntriesResponse;
    }),
  };
  const deps: V2ControllerDeps = {
    api: api as unknown as WINRAPI,
    storage: fakeStorage({ 'winr_email_submitted_com.test': 'true' }),
    bundleId: 'com.test',
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => true,
  };
  return { controller: new V2ExperienceController(deps), api };
}

describe('V2 Day 2+ reveal flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('day 1 auto-claim lands on the celebration modal (the day-1 reveal) — no auto-reveal timer', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 0, totalEntries: 0 },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
    });
    await controller.load();

    expect(controller.state.kind).toBe('celebration');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(true);

    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(false);
  });

  it('day 2+ auto-claim shows NO celebration modal — dashboard pinned with a pending reveal', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();

    // Silent claim happened…
    expect(controller.claimedToday).toBe(true);
    expect(controller.streakDay).toBe(5);
    expect(controller.totalEntries).toBe(470);

    // …but the UI is told to hold yesterday's numbers until the auto-reveal.
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 130, bonusEntries: 0 });
    expect(controller.claimRevealed).toBe(false);
    // Pre-claim total = post-claim minus the full grant.
    expect(controller.preClaimTotalEntries).toBe(340);
  });

  it('bonus entries roll into the pending grant and the pre-claim total', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 6, totalEntries: 770 },
      claim: {
        entries: 300,
        streakDay: 7,
        totalEntries: 1095,
        milestone: { day: 7, bonusEntries: 25 },
      },
    });
    await controller.load();

    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 300, bonusEntries: 25 });
    expect(controller.preClaimTotalEntries).toBe(770);
  });

  it('the celebration fires ON ITS OWN ~800ms after the claim lands — no click needed', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
    });
    await controller.load();

    // Pinned right up until the delay elapses…
    expect(controller.claimRevealed).toBe(false);
    vi.advanceTimersByTime(DELAY - 1);
    expect(controller.claimRevealed).toBe(false);

    // …then it plays by itself.
    vi.advanceTimersByTime(1);
    expect(controller.claimRevealed).toBe(true);
  });

  it('re-arming and double-firing are harmless (reveal is one-shot)', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
    });

    // No pending grant yet → arming is a no-op.
    controller.scheduleAutoReveal();
    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(false);

    await controller.load();
    // Re-arm on top of the claim path's own arm (e.g. a re-render).
    controller.scheduleAutoReveal();
    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(true);

    // Direct re-entry stays idempotent.
    controller.revealClaim();
    controller.scheduleAutoReveal();
    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(true);
  });

  it('dismissal before the reveal disarms the timer — it must no-op safely', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
    });
    await controller.load();
    expect(controller.pendingRevealGrant).not.toBeNull();

    // Root.dismiss() cancels the pending auto-reveal on teardown.
    controller.cancelAutoReveal();
    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(false);
  });

  it('come-back bar entries are ladder(N+1) in both reveal states', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
    });
    await controller.load();

    // Pre-reveal: streakDay is already N (3) → next is ladder(4).
    expect(controller.nextEntries).toBe(130);
    vi.advanceTimersByTime(DELAY);
    expect(controller.claimRevealed).toBe(true);
    expect(controller.nextEntries).toBe(130);
  });

  it('the pill reads GOT IT throughout and the celebration mutates the dashboard in place', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();

    const dash = renderDashboard(controller, null, () => {});
    // Attach so the toast hold timer's teardown guard sees a live DOM.
    document.body.appendChild(dash);

    // Pinned pre-reveal frame: GOT IT pill (no CLAIM), yesterday's streak
    // label, today's tile "ready", come-back pitch (no toast).
    const pill = dash.querySelector('.wv2-pill');
    expect(pill?.textContent).toBe('GOT IT');
    expect(dash.querySelector('.wv2-stat-streak')?.textContent).toBe('4 DAY STREAK');
    expect(dash.querySelector('.wv2-tile.wv2-ready')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile.wv2-active')).toBeNull();
    expect(dash.querySelector('.wv2-comeback')?.classList.contains('wv2-toasting')).toBe(false);

    // The celebration fires on its own: "N ENTRIES ADDED" slides into the
    // bar and holds (.wv2-toasting = the hold window).
    vi.advanceTimersByTime(DELAY);

    expect(controller.claimRevealed).toBe(true);
    expect(dash.querySelector('.wv2-tile.wv2-ready')).toBeNull();
    expect(dash.querySelector('.wv2-tile.wv2-active')).not.toBeNull();
    expect(dash.querySelector('.wv2-stat-streak')?.textContent).toBe('5 DAY STREAK');
    const comeback = dash.querySelector('.wv2-comeback');
    expect(comeback?.classList.contains('wv2-toasting')).toBe(true);
    expect(comeback?.querySelector('.wv2-cb-added')?.textContent).toBe('130 ENTRIES ADDED');
    // Still GOT IT — the pill never changed and only dismisses.
    expect(pill?.textContent).toBe('GOT IT');

    // After the ~2.6s hold the toast slides back out: the bar's FINAL
    // resting state is the come-back pitch, not the ADDED toast.
    vi.advanceTimersByTime(COMEBACK_TOAST_HOLD_MS);
    expect(comeback?.classList.contains('wv2-toasting')).toBe(false);
    dash.remove();
  });

  it("the reveal mounts Joe's tile-burst GIF once; it removes itself and rests on the static check", async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();

    const dash = renderDashboard(controller, null, () => {});
    document.body.appendChild(dash);

    // Pre-reveal: no burst overlay anywhere, ready tile's icon slot empty.
    expect(dash.querySelector('.wv2-tile-burst')).toBeNull();

    // The reveal beat flips the tile AND mounts the GIF in the same pass.
    vi.advanceTimersByTime(DELAY);
    const tile = dash.querySelector('.wv2-tile.wv2-active');
    expect(tile).not.toBeNull();
    const burst = dash.querySelector('.wv2-tile-burst') as HTMLImageElement;
    expect(burst).not.toBeNull();
    // Fresh <img> with the embedded GIF — mounting starts playback at frame 0.
    expect(burst.src).toBe(V2_IMAGES.tileBurst);
    // During the burst the icon slot is an empty spacer (the GIF paints the
    // check) — layout matches the other states.
    expect(tile?.querySelector('.wv2-tile-icon')?.childElementCount).toBe(0);

    // After the GIF's full one-shot run the overlay is removed and the tile
    // rests on the SAME small static check as completed tiles.
    vi.advanceTimersByTime(TILE_BURST_DURATION_MS);
    expect(dash.querySelector('.wv2-tile-burst')).toBeNull();
    const restingCheck = tile?.querySelector('.wv2-tile-icon img') as HTMLImageElement;
    expect(restingCheck?.src).toBe(V2_IMAGES.checkCompleted);
    dash.remove();
  });

  it('tile-burst teardown guard: dismissing mid-burst never touches removed DOM', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();

    const dash = renderDashboard(controller, null, () => {});
    document.body.appendChild(dash);
    vi.advanceTimersByTime(DELAY);
    const iconWrap = dash.querySelector('.wv2-tile.wv2-active .wv2-tile-icon');
    expect(dash.querySelector('.wv2-tile-burst')).not.toBeNull();

    // Dashboard unmounts before the GIF finishes → the removal timer no-ops.
    dash.remove();
    vi.advanceTimersByTime(TILE_BURST_DURATION_MS);
    // The detached tile was never mutated: no resting check swapped in.
    expect(iconWrap?.childElementCount).toBe(0);
  });

  it('a dashboard that mounts already claimed rests on the come-back pitch — no toast replay', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470, claimedToday: true },
    });
    await controller.load();
    expect(controller.pendingRevealGrant).toBeNull();

    const dash = renderDashboard(controller, null, () => {});
    const comeback = dash.querySelector('.wv2-comeback');
    expect(comeback?.classList.contains('wv2-toasting')).toBe(false);
    expect(comeback?.querySelector('.wv2-comeback-line')?.textContent).toBe(
      'Come back tomorrow to\nkeep your streak alive and receive:'
    );
    vi.advanceTimersByTime(DELAY * 2 + COMEBACK_TOAST_HOLD_MS);
    expect(comeback?.classList.contains('wv2-toasting')).toBe(false);
  });

  it('"Already claimed" (cross-device) keeps the plain dashboard — no pending reveal, no timer', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470, claimedToday: false },
      claimError: new Error('Already claimed today'),
    });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(true);
    // One-shot re-sync pulled the authoritative state again.
    expect(api.getActiveGiveaway).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(false);
  });

  it('silent auto-claim failure keeps the plain unclaimed dashboard — no pending reveal, no timer', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470 },
      claimError: new Error('network down'),
    });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(false);

    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(false);
  });

  it('already claimed today per the backend → plain dashboard, no claim call, no reveal', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470, claimedToday: true },
    });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toBeNull();
  });
});
