import { describe, it, expect, vi } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import {
  ClaimDailyEntriesResponse,
  GetActiveGiveawayResponse,
  Giveaway,
} from '../src/types';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Day 2+ reveal flow (parity with iOS commit e7fae27).
 *
 * The auto-claim on open grants entries server-side immediately, but:
 *  - streakDay <= 1 → the "You're in!" celebration modal is the reveal.
 *  - streakDay >= 2 → NO modal. The controller lands on the dashboard with a
 *    pending reveal grant: the UI pins yesterday's numbers (streak label N-1,
 *    pre-claim total) until revealClaim() is called by the CLAIM pill.
 *  - "Already claimed" (cross-device) and silent auto-claim failures are
 *    unchanged: plain dashboard, no pending reveal.
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
  it('day 1 auto-claim lands on the celebration modal (the day-1 reveal)', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 0, totalEntries: 0 },
      claim: { entries: 10, streakDay: 1, totalEntries: 10 },
    });
    await controller.load();

    expect(controller.state.kind).toBe('celebration');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(true);
  });

  it('day 2+ auto-claim shows NO celebration modal — dashboard with a pending reveal', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 4, totalEntries: 340 },
      claim: { entries: 130, streakDay: 5, totalEntries: 470 },
    });
    await controller.load();

    // Silent claim happened…
    expect(controller.claimedToday).toBe(true);
    expect(controller.streakDay).toBe(5);
    expect(controller.totalEntries).toBe(470);

    // …but the UI is told to hold yesterday's numbers behind CLAIM.
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

  it('revealClaim() flips claimRevealed exactly once and only with a pending grant', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
    });

    // No pending grant yet → no-op.
    controller.revealClaim();
    expect(controller.claimRevealed).toBe(false);

    await controller.load();
    expect(controller.pendingRevealGrant).not.toBeNull();

    controller.revealClaim();
    expect(controller.claimRevealed).toBe(true);

    // Idempotent.
    controller.revealClaim();
    expect(controller.claimRevealed).toBe(true);
  });

  it('come-back bar entries are ladder(N+1) in both reveal states', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 2, totalEntries: 40 },
      claim: { entries: 60, streakDay: 3, totalEntries: 100 },
    });
    await controller.load();

    // Pre-reveal: streakDay is already N (3) → next is ladder(4).
    expect(controller.nextEntries).toBe(130);
    controller.revealClaim();
    expect(controller.nextEntries).toBe(130);
  });

  it('"Already claimed" (cross-device) keeps the plain dashboard — no pending reveal', async () => {
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
  });

  it('silent auto-claim failure keeps the plain unclaimed dashboard — no pending reveal', async () => {
    const { controller } = makeController({
      giveawayResponse: { streakDay: 5, totalEntries: 470 },
      claimError: new Error('network down'),
    });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.pendingRevealGrant).toBeNull();
    expect(controller.claimedToday).toBe(false);
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
