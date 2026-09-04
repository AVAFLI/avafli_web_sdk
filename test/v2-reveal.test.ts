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
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * In-place reveal flow: the celebration is ALWAYS the dashboard's FIRST
 * VISIBLE FRAME — there is no celebration modal (deleted; Day 1 is unified
 * with Day 2+).
 *
 * SERVER CONTRACT (mirrors functions/src getActiveGiveaway): when today is
 * unclaimed, `streakDay` is ALREADY the day today's claim will be (the
 * backend advances it past the last-claimed day), and claimDailyEntries
 * returns that SAME day. Fixtures here model that: giveawayResponse.streakDay
 * === claim.streakDay for an alive streak, and claim.entries === ladder value
 * for that day.
 *
 *  - streakDay < 2 (day-1 claim: brand-new or broken streak) → the claim is
 *    AWAITED while the previous screen holds (email capture spinner /
 *    loading), and the grant is staged straight from the claim response
 *    before the dashboard mounts. Day 1's toast headline is "YOU'RE IN!".
 *  - streakDay >= 2 (the day-2+ claim) → a PREDICTED grant (the ladder value
 *    for that same server-reported day — never day+1) is staged from the
 *    pre-claim status response BEFORE entering the dashboard; the
 *    celebration fires on first mount (~0.15s) and the real claim runs in
 *    the background, reconciling totals/streak silently (no second
 *    celebration). The pill reads GOT IT the whole time.
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
  /** Seed (or omit) the local non-PII "email submitted" flag. */
  emailSubmitted?: boolean;
}): {
  controller: V2ExperienceController;
  api: { getActiveGiveaway: ReturnType<typeof vi.fn> };
  storage: LocalStorageProvider;
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
  const storage = fakeStorage(
    options.emailSubmitted === false ? {} : { 'winr_email_submitted_com.test': 'true' }
  );
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage,
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
  return { controller: new V2ExperienceController(deps), api, storage, releaseClaim, settle };
}

describe('V2 Day 2+ reveal flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('day 1 stages the reveal FROM THE CLAIM RESPONSE — dashboard first frame, never a modal', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 0, totalEntries: 0 },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
    });
    await controller.load();

    // Straight to the dashboard with the grant staged from the awaited
    // claim (no prediction, no 'celebration' modal state — it no longer
    // exists) and the first-mount reveal armed.
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.claimedToday).toBe(true);
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 10, bonusEntries: 0 });
    expect(controller.preClaimTotalEntries).toBe(0);
    expect(controller.claimRevealed).toBe(false);

    vi.advanceTimersByTime(DELAY);
    expect(controller.claimRevealed).toBe(true);
  });

  it('day 1 never stages the PREDICTED celebration — the claim is awaited while the previous screen holds', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 0, totalEntries: 0 },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
      holdClaim: true,
    });
    const loadPromise = controller.load();
    await vi.advanceTimersByTimeAsync(0);

    // Claim in flight: NO predicted staging and NO dashboard yet — the
    // previous screen (here the loading state) holds.
    expect(controller.state.kind).toBe('loading');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimRevealed).toBe(false);

    await releaseClaim();
    await loadPromise;
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 10, bonusEntries: 0 });
  });

  it('a broken/new streak (server streakDay 1) awaits the claim — prediction is gated to streakDay >= 2', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 1, totalEntries: 0 },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
      holdClaim: true,
    });
    const loadPromise = controller.load();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.state.kind).toBe('loading');
    expect(controller.pendingRevealGrant).toBeNull();

    await releaseClaim();
    await loadPromise;
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 10, bonusEntries: 0 });
    expect(controller.preClaimTotalEntries).toBe(0);
    vi.advanceTimersByTime(DELAY);
    expect(controller.claimRevealed).toBe(true);
  });

  it('the day-2 claim stages the prediction — the server already reports today as day 2', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 10 },
      claim: { entries: 30, streakDay: 2, totalEntries: 40 },
      holdClaim: true,
    });
    await controller.load();

    // No waiting on the claim: predicted grant = ladder(day 2) = 30, and the
    // staged day is the SERVER'S day — never advanced again client-side.
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 30, bonusEntries: 0 });
    expect(controller.streakDay).toBe(2);
    expect(controller.preClaimTotalEntries).toBe(10);

    await releaseClaim();
    expect(controller.streakDay).toBe(2);
    expect(controller.totalEntries).toBe(40);
  });

  it('email submit HOLDS the capture screen (spinner) through the claim, then the dashboard mounts as the celebration', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 0, totalEntries: 0, emailConsentStatus: false },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
      holdClaim: true,
      emailSubmitted: false,
    });
    await controller.load();
    expect(controller.state.kind).toBe('emailCapture');

    const submitPromise = controller.submitEmail('ada@example.com', {
      ageConfirmed: true,
      marketingConsent: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Email sent, reload done, Day-1 claim STILL IN FLIGHT: the capture
    // screen is still the rendered state, its CTA still spinning. The user
    // never sees a loading interstitial or a pre-claim dashboard.
    expect(controller.state.kind).toBe('emailCapture');
    expect(controller.isSubmittingEmail).toBe(true);
    expect(controller.pendingRevealGrant).toBeNull();

    await releaseClaim();
    await submitPromise;
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.isSubmittingEmail).toBe(false);
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 10, bonusEntries: 0 });
    expect(controller.claimRevealed).toBe(false);
    vi.advanceTimersByTime(DELAY);
    expect(controller.claimRevealed).toBe(true);
  });

  it('day 1 dashboard greets with the "YOU’RE IN!" toast and counts up 0→N in place', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 0, totalEntries: 0 },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
    });
    await controller.load();

    const dash = renderDashboard(controller, null, () => {});
    document.body.appendChild(dash);

    // First visible frame: toast-first bar with the DAY-1 headline (same
    // subline as Day 2+), stats pinned to the pre-claim zero, today's tile
    // "ready", GOT IT pill.
    const comeback = dash.querySelector('.wv2-comeback');
    expect(comeback?.classList.contains('wv2-toast-start')).toBe(true);
    expect(comeback?.querySelector('.wv2-cb-added')?.textContent).toBe('YOU’RE IN!');
    expect(comeback?.querySelector('.wv2-cb-roll')?.textContent).toBe(
      'Your 10 entries have been added automatically.'
    );
    expect(dash.querySelector('.wv2-stat-total')?.textContent).toBe('0');
    expect(dash.querySelector('.wv2-tile.wv2-ready')).not.toBeNull();
    expect(dash.querySelector('.wv2-pill')?.textContent).toBe('GOT IT');

    // The reveal fires on its own: tile explosion (check + confetti field +
    // burst GIF) on the Day-1 tile, streak label set, count-up armed.
    vi.advanceTimersByTime(DELAY);
    expect(controller.claimRevealed).toBe(true);
    const tile = dash.querySelector('.wv2-tile.wv2-active');
    expect(tile).not.toBeNull();
    expect(tile?.querySelector('.wv2-tile-icon .wv2-animated-check')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile-confetti')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile-burst')).not.toBeNull();
    expect(dash.querySelector('.wv2-stat-streak')?.textContent).toBe('1 DAY STREAK');
    dash.remove();
  });

  it('day 2+ stages a PREDICTED grant from the pre-claim response — no waiting on the claim', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 240, streakDay: 5, totalEntries: 580 },
      holdClaim: true,
    });
    await controller.load();

    // The claim round-trip is STILL IN FLIGHT, yet the celebration is fully
    // staged: predicted grant = ladder(day 5) = 240 — the SAME day the
    // server reported (it already advanced the counter; a client-side +1
    // was the header/tile off-by-one bug), predicted totals on top.
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
    expect(controller.totalEntries).toBe(580);
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 240, bonusEntries: 0 });
    expect(controller.preClaimTotalEntries).toBe(340);
  });

  it('milestone bonuses reconcile into the grant when the real claim lands', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 7, totalEntries: 770 },
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
      giveawayResponse: { streakDay: 3, totalEntries: 40 },
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
      giveawayResponse: { streakDay: 3, totalEntries: 40 },
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
      giveawayResponse: { streakDay: 3, totalEntries: 40 },
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
      giveawayResponse: { streakDay: 3, totalEntries: 40 },
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
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 240, streakDay: 5, totalEntries: 580 },
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
      'Your 240 entries have been added automatically.'
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
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 240, streakDay: 5, totalEntries: 580 },
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
    const burst = dash.querySelector('.wv2-tile-burst') as HTMLElement;
    expect(burst).not.toBeNull();
    // Canvas-drawn (never a GIF: WebKit skips GIF playback under reduced motion).
    expect(burst.tagName).toBe('CANVAS');

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
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 240, streakDay: 5, totalEntries: 580 },
    });
    await controller.load();
    await settle();

    const dash = renderDashboard(controller, null, () => {});
    document.body.appendChild(dash);
    vi.advanceTimersByTime(DELAY);
    const burst = dash.querySelector('.wv2-tile-burst') as HTMLElement;
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

  it('a server day that DISAGREES with the staged day forces a full dashboard repaint — tiles never stay a day ahead', async () => {
    // Staged for day 5, but the server (source of truth) claims day 4 — e.g.
    // a midnight rollover between the status fetch and the claim. The quiet
    // in-place reconcile only rewrites the header/total, so a repaint is the
    // only way the RAIL and come-back bar agree with the header again.
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 130, streakDay: 4, totalEntries: 470 },
      holdClaim: true,
    });
    await controller.load();
    expect(controller.streakDay).toBe(5); // staged

    const renders: string[] = [];
    controller.onChange = (state) => renders.push(state.kind);

    await releaseClaim();
    expect(controller.streakDay).toBe(4); // server truth
    expect(controller.totalEntries).toBe(470);
    expect(renders).toContain('dashboard'); // full repaint, not in-place only
  });

  it('a matching reconcile stays IN PLACE — no dashboard re-render (no animation replay)', async () => {
    const { controller, releaseClaim } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 240, streakDay: 5, totalEntries: 580 },
      holdClaim: true,
    });
    await controller.load();

    const renders: string[] = [];
    controller.onChange = (state) => renders.push(state.kind);

    await releaseClaim();
    expect(controller.streakDay).toBe(5);
    expect(renders).toEqual([]); // reconciled via onRevealReconcile only
  });

  it('a successful claim persists the post-claim streak state for the NEXT cache-first frame', async () => {
    const { controller, releaseClaim, storage } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 340 },
      claim: { entries: 240, streakDay: 5, totalEntries: 580, weeklyCurrent: 5, monthlyCurrent: 5 },
      holdClaim: true,
    });
    await controller.load();
    // Nothing persisted while the claim is still in flight.
    expect(storage.getItem('winr_streak_state')).toBeNull();

    await releaseClaim();
    const persisted = JSON.parse(storage.getItem('winr_streak_state') ?? '{}');
    expect(persisted.currentDay).toBe(5);
    expect(persisted.totalEntriesEarned).toBe(580);
    expect(persisted.weeklyCurrent).toBe(5);
    expect(persisted.monthlyCurrent).toBe(5);
    // lastClaimedDate marks TODAY so the next open's cache frame knows the
    // claim already happened.
    expect(new Date(persisted.lastClaimedDate).toDateString()).toBe(new Date().toDateString());
  });
});
