// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { COMEBACK_TOAST_HOLD_MS, renderDashboard } from '../src/ui/v2/screens';
import { CONFETTI_BURST_DURATION_MS } from '../src/ui/v2/effects';
import { V2_IMAGES } from '../src/ui/v2/assets.generated';
import {
  ClaimDailyEntriesResponse,
  GetActiveGiveawayResponse,
  Giveaway,
} from '../src/types';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Day 2+ reveal flow: the celebration is the dashboard's FIRST VISIBLE FRAME.
 *
 *  - Pre-claim streakDay 0 (day 1) → the awaited auto-claim's "You're in!"
 *    celebration modal is the reveal.
 *  - Pre-claim streakDay >= 1 (day 2+) → NO modal and NO claim click. A
 *    PREDICTED grant (ladder value for the streak day being claimed today)
 *    is staged from the pre-claim status response BEFORE entering the
 *    dashboard; the celebration fires on first mount (~0.15s) and the real
 *    claim runs in the background, reconciling totals/streak silently (no
 *    second celebration). The pill reads GOT IT the whole time.
 *  - "Already claimed" (cross-device) re-syncs once; other claim failures
 *    settle back to the pre-claim server truth quietly.
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
  /** Hold the claim response until releaseClaim() — pins the predicted frame. */
  holdClaim?: boolean;
}): {
  controller: V2ExperienceController;
  api: { getActiveGiveaway: ReturnType<typeof vi.fn> };
  releaseClaim: () => Promise<void>;
  settle: () => Promise<void>;
} {
  const giveawayResponse: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY,
    claimedToday: false,
    streakDay: 1,
    totalEntries: 0,
    emailConsentStatus: true,
    ...options.giveawayResponse,
  };
  let release: (() => void) | null = null;
  const gate = options.holdClaim
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : null;
  const api = {
    getActiveGiveaway: vi.fn(async () => giveawayResponse),
    claimDailyEntries: vi.fn(async () => {
      if (gate) await gate;
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
  /** Flushes the background reconcile's microtasks without advancing time. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  const releaseClaim = async (): Promise<void> => {
    release?.();
    await settle();
  };
  return { controller: new V2ExperienceController(deps), api, releaseClaim, settle };
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

  it('day 2+ stages a PREDICTED grant from the pre-claim response — no waiting on the claim', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
      holdClaim: true,
    });
    await controller.load();

    // The claim round-trip is STILL IN FLIGHT, yet the celebration is fully
    // staged: predicted grant = ladder(day 5) = 240, predicted totals.
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 240, bonusEntries: 0 });
    expect(controller.streakDay).toBe(5);
    expect(controller.totalEntries).toBe(580); // 340 + predicted 240
    expect(controller.preClaimTotalEntries).toBe(340);
    expect(controller.claimRevealed).toBe(false);
    expect(controller.claimedToday).toBe(false);

    // The background claim lands → totals/streak reconcile silently to
    // server truth (no second celebration, claimRevealed untouched).
    await releaseClaim();
    expect(controller.claimedToday).toBe(true);
    expect(controller.streakDay).toBe(5);
    expect(controller.totalEntries).toBe(470);
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 130, bonusEntries: 0 });
    expect(controller.preClaimTotalEntries).toBe(340);
  });

  it('milestone bonuses reconcile into the grant when the real claim lands', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 6, totalEntries: 770 },
      claim: {
        entries: 300,
        streakDay: 7,
        totalEntries: 1095,
        milestone: { day: 7, bonusEntries: 25 },
      },
      holdClaim: true,
    });
    await controller.load();

    // Prediction is pure ladder math (ladder tops out at 300 for day 7).
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 300, bonusEntries: 0 });
    expect(controller.preClaimTotalEntries).toBe(770);

    await releaseClaim();
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 300, bonusEntries: 25 });
    expect(controller.preClaimTotalEntries).toBe(770);
    expect(controller.totalEntries).toBe(1095);
  });

  it('the celebration fires ON ITS OWN ~150ms after first mount — no click, no network wait', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
      holdClaim: true, // the claim NEVER lands in this test — reveal anyway
    });
    await controller.load();

    // Pinned right up until the first-mount beat elapses…
    expect(controller.claimRevealed).toBe(false);
    vi.advanceTimersByTime(DELAY - 1);
    expect(controller.claimRevealed).toBe(false);

    // …then it plays by itself, network still in flight.
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

  it('the pill reads GOT IT, the toast is the FIRST visible bar state, and the celebration mutates in place', async () => {
    const { controller, settle } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();
    await settle(); // background claim reconciled before the dashboard mounts

    const dash = renderDashboard(controller, null, () => {});
    // Attach so the toast hold timer's teardown guard sees a live DOM.
    document.body.appendChild(dash);

    // First visible frame: GOT IT pill (no CLAIM), yesterday's streak label
    // for the one pre-reveal beat, today's tile "ready" — and the toast
    // ALREADY showing (toast-first, never the pitch first).
    const pill = dash.querySelector('.wv2-pill');
    expect(pill?.textContent).toBe('GOT IT');
    expect(dash.querySelector('.wv2-stat-streak')?.textContent).toBe('4 DAY STREAK');
    expect(dash.querySelector('.wv2-tile.wv2-ready')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile.wv2-active')).toBeNull();
    const comeback = dash.querySelector('.wv2-comeback');
    expect(comeback?.classList.contains('wv2-toast-start')).toBe(true);
    expect(comeback?.classList.contains('wv2-untoasting')).toBe(false);
    expect(comeback?.querySelector('.wv2-cb-added')?.textContent).toBe('YOU’RE ON A ROLL!');
    expect(comeback?.querySelector('.wv2-cb-roll')?.textContent).toBe(
      'Your 130 entries have been added automatically.'
    );

    // The celebration fires on its own at the first-mount beat.
    vi.advanceTimersByTime(DELAY);

    expect(controller.claimRevealed).toBe(true);
    expect(dash.querySelector('.wv2-tile.wv2-ready')).toBeNull();
    expect(dash.querySelector('.wv2-tile.wv2-active')).not.toBeNull();
    expect(dash.querySelector('.wv2-stat-streak')?.textContent).toBe('5 DAY STREAK');
    // The toast is still holding; the pill never changed and only dismisses.
    expect(comeback?.classList.contains('wv2-toast-start')).toBe(true);
    expect(pill?.textContent).toBe('GOT IT');

    // After the ~2.5s hold the toast slides ONCE to the come-back pitch —
    // the bar's FINAL resting state.
    vi.advanceTimersByTime(COMEBACK_TOAST_HOLD_MS);
    expect(comeback?.classList.contains('wv2-toast-start')).toBe(false);
    expect(comeback?.classList.contains('wv2-untoasting')).toBe(true);
    dash.remove();
  });

  it('the reveal restores the drawn check + confetti field and pops the one-shot confetti-burst GIF', async () => {
    const { controller, settle } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();
    await settle();

    const dash = renderDashboard(controller, null, () => {});
    document.body.appendChild(dash);

    // Pre-reveal beat: the ready tile is calm — no burst, no confetti field.
    expect(dash.querySelector('.wv2-tile-burst')).toBeNull();
    expect(dash.querySelector('.wv2-tile-confetti')).toBeNull();

    // The reveal flips the tile AND mounts the whole lockup in one pass:
    // drawn check in the icon slot, falling-confetti field, burst GIF.
    vi.advanceTimersByTime(DELAY);
    const tile = dash.querySelector('.wv2-tile.wv2-active');
    expect(tile).not.toBeNull();
    expect(tile?.querySelector('.wv2-tile-icon .wv2-animated-check')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile-confetti')).not.toBeNull();
    const burst = dash.querySelector('.wv2-tile-burst') as HTMLImageElement;
    expect(burst).not.toBeNull();
    // Fresh <img> with the embedded GIF — mounting starts playback at frame 0.
    expect(burst.src).toBe(V2_IMAGES.confettiBurst);

    // After the GIF's full one-shot run only the burst overlay is removed —
    // the drawn check and confetti field ARE the active tile's resting state.
    vi.advanceTimersByTime(CONFETTI_BURST_DURATION_MS);
    expect(dash.querySelector('.wv2-tile-burst')).toBeNull();
    expect(tile?.querySelector('.wv2-tile-icon .wv2-animated-check')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile-confetti')).not.toBeNull();
    dash.remove();
  });

  it('burst teardown guard: dismissing mid-burst never touches removed DOM', async () => {
    const { controller, settle } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();
    await settle();

    const dash = renderDashboard(controller, null, () => {});
    document.body.appendChild(dash);
    vi.advanceTimersByTime(DELAY);
    const burst = dash.querySelector('.wv2-tile-burst') as HTMLImageElement;
    expect(burst).not.toBeNull();

    // Dashboard unmounts before the GIF finishes → the removal timer no-ops
    // (the overlay left the document with its parent and is left untouched).
    dash.remove();
    vi.advanceTimersByTime(CONFETTI_BURST_DURATION_MS);
    expect(burst.isConnected).toBe(false);
    expect(burst.parentElement).not.toBeNull();
  });

  it('a dashboard that mounts already claimed rests on the come-back pitch — no toast replay', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470, claimedToday: true },
    });
    await controller.load();
    expect(controller.pendingRevealGrant).toBeNull();

    const dash = renderDashboard(controller, null, () => {});
    const comeback = dash.querySelector('.wv2-comeback');
    expect(comeback?.classList.contains('wv2-toast-start')).toBe(false);
    expect(comeback?.classList.contains('wv2-untoasting')).toBe(false);
    expect(comeback?.querySelector('.wv2-comeback-line')?.textContent).toBe(
      'Come back tomorrow to\nkeep your streak alive and receive:'
    );
    vi.advanceTimersByTime(DELAY * 2 + COMEBACK_TOAST_HOLD_MS);
    expect(comeback?.classList.contains('wv2-toast-start')).toBe(false);
    expect(comeback?.classList.contains('wv2-untoasting')).toBe(false);
  });

  it('"Already claimed" (cross-device) drops the predicted grant and re-syncs once — no celebration', async () => {
    const { controller, api, settle } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470, claimedToday: false },
      claimError: new Error('Already claimed today'),
    });
    await controller.load();
    await settle(); // let the background claim reject + re-sync

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(true);
    // One-shot re-sync pulled the authoritative state again.
    expect(api.getActiveGiveaway).toHaveBeenCalledTimes(2);
    expect(controller.streakDay).toBe(5);
    expect(controller.totalEntries).toBe(470);

    vi.advanceTimersByTime(DELAY * 2);
    expect(controller.claimRevealed).toBe(false);
  });

  it('silent claim failure settles back to the pre-claim server truth — no celebration', async () => {
    const { controller, settle } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470 },
      claimError: new Error('network down'),
    });
    await controller.load();
    await settle(); // let the background claim reject + settle

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(false);
    // Predicted streak/totals were rolled back to the pre-claim response.
    expect(controller.streakDay).toBe(5);
    expect(controller.totalEntries).toBe(470);

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
