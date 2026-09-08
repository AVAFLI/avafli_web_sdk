import { describe, it, expect, vi } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { GetActiveGiveawayResponse, Giveaway } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';
import { AvafliV2Strings } from '../src/ui/v2/strings';

/**
 * Adoption RE-ENTRY (2.9): when the register response reports
 * `adoptionPending: true` (this device typed an email that matched an
 * existing account but never finished the 6-digit code), the next
 * drawer-open must:
 *  - call the new `restageAdoption` callable (re-sends a fresh code), then
 *  - route to the 6-digit code screen in its re-entry variant, and
 *  - complete the normal adoption path once the code is verified.
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
  adoptionPending?: boolean;
  restageError?: Error;
  verifyError?: Error;
  storageSeed?: Record<string, string>;
  restageGate?: { resolve: () => void; promise: Promise<void> };
}): {
  controller: V2ExperienceController;
  restageAdoption: ReturnType<typeof vi.fn>;
  verifyAdoptionCode: ReturnType<typeof vi.fn>;
  onAdoptionResolved: ReturnType<typeof vi.fn>;
  api: { getActiveGiveaway: ReturnType<typeof vi.fn>; claimDailyEntries: ReturnType<typeof vi.fn> };
} {
  const giveawayResponse: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY,
    claimedToday: true,
    streakDay: 3,
    totalEntries: 100,
    emailConsentStatus: true,
  };
  const api = {
    getActiveGiveaway: vi.fn(async () => giveawayResponse),
    claimDailyEntries: vi.fn(async () => ({ entries: 60, streakDay: 4, totalEntries: 160 })),
  };
  const restageAdoption = vi.fn(async () => {
    if (options.restageGate) await options.restageGate.promise;
    if (options.restageError) throw options.restageError;
    return { sent: true };
  });
  const verifyAdoptionCode = vi.fn(async () => {
    if (options.verifyError) throw options.verifyError;
    return { adopted: true };
  });
  const onAdoptionResolved = vi.fn();
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage: fakeStorage({ winr_email_submitted_com_test: 'true', ...(options.storageSeed ?? {}) }),
    bundleId: 'com_test',
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => true,
    adoptionPending: options.adoptionPending === true,
    restageAdoption,
    verifyAdoptionCode,
    onAdoptionResolved,
  };
  return { controller: new V2ExperienceController(deps), restageAdoption, verifyAdoptionCode, onAdoptionResolved, api };
}

describe('Adoption re-entry (adoptionPending)', () => {
  it('routes the drawer-open to the code screen after calling restageAdoption', async () => {
    const { controller, restageAdoption } = makeController({ adoptionPending: true });
    await controller.load();

    expect(restageAdoption).toHaveBeenCalledOnce();
    expect(controller.state.kind).toBe('codeEntry');
    if (controller.state.kind === 'codeEntry') {
      expect(controller.state.reentry).toBe(true);
      expect(controller.state.email).toBeUndefined();
    }
  });

  it('without adoptionPending nothing changes — the dashboard shows as usual', async () => {
    const { controller, restageAdoption } = makeController({ adoptionPending: false });
    await controller.load();

    expect(restageAdoption).not.toHaveBeenCalled();
    expect(controller.state.kind).toBe('dashboard');
  });

  it('a failed restage still shows the code screen (resend remains available)', async () => {
    const { controller, restageAdoption } = makeController({
      adoptionPending: true,
      restageError: new Error('Failed to fetch'),
    });
    await controller.load();

    expect(restageAdoption).toHaveBeenCalledOnce();
    expect(controller.state.kind).toBe('codeEntry');
  });

  it('"Send a new code" in re-entry mode goes through restageAdoption (no email in memory)', async () => {
    const { controller, restageAdoption } = makeController({ adoptionPending: true });
    await controller.load();
    expect(restageAdoption).toHaveBeenCalledTimes(1);

    await controller.resendVerificationCode();
    expect(restageAdoption).toHaveBeenCalledTimes(2);
    expect(controller.state.kind).toBe('codeEntry');
    expect(controller.codeError).toBeNull();
  });

  it('a correct code completes the adoption, clears the pending flag, and lands on the dashboard', async () => {
    const { controller, verifyAdoptionCode, onAdoptionResolved } = makeController({
      adoptionPending: true,
    });
    await controller.load();

    await controller.submitVerificationCode('123456');
    expect(verifyAdoptionCode).toHaveBeenCalledWith({ code: '123456' });
    expect(onAdoptionResolved).toHaveBeenCalledOnce();
    // The re-entry is one-shot: the post-verify reload must NOT re-stage.
    expect(controller.state.kind).toBe('dashboard');
  });

  it('a wrong code stays on the code screen with the fixed error copy', async () => {
    const { controller, onAdoptionResolved } = makeController({
      adoptionPending: true,
      verifyError: new Error('invalid-argument: code mismatch'),
    });
    await controller.load();

    await controller.submitVerificationCode('000000');
    expect(controller.state.kind).toBe('codeEntry');
    expect(controller.codeError).toMatch(/didn't match/i);
    expect(onAdoptionResolved).not.toHaveBeenCalled();
  });

  // ── Sept 2026: the code screen is the FIRST frame, and codes don't spam ──
  //
  // Field report (demo publisher): a browser with a parked cross-device link
  // painted the cached "DAY 1" dashboard for the 3–5 s the register →
  // giveaway → restage round-trips took, mailed a code, and only THEN
  // switched to the code screen. Close the drawer inside that window and you
  // have an e-mail in your inbox and no memory of any code prompt.

  const CACHED = {
    winr_cached_giveaway: JSON.stringify(GIVEAWAY),
    winr_streak_state: JSON.stringify({ currentDay: 1, totalEntriesEarned: 0, lastClaimedDate: null }),
  };

  it('a pending link makes the code screen the first frame — never the cached dashboard', () => {
    const { controller } = makeController({ adoptionPending: true, storageSeed: CACHED });
    expect(controller.hydrateFromCache()).toBe(true);
    expect(controller.state.kind).toBe('codeEntry');
    if (controller.state.kind === 'codeEntry') expect(controller.state.reentry).toBe(true);
    // The giveaway is still carried across so the header art can paint.
    expect(controller.giveaway?.id).toBe('g1');
  });

  it('without a pending link the same cache still paints the dashboard first', () => {
    const { controller } = makeController({ adoptionPending: false, storageSeed: CACHED });
    expect(controller.hydrateFromCache()).toBe(true);
    expect(controller.state.kind).toBe('dashboard');
  });

  it('the code screen is on screen BEFORE the restage round-trip resolves', async () => {
    let release!: () => void;
    const gate = { promise: new Promise<void>((r) => { release = r; }), resolve: () => release() };
    const { controller, restageAdoption } = makeController({ adoptionPending: true, restageGate: gate });
    const loading = controller.load();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(restageAdoption).toHaveBeenCalledOnce();
    expect(controller.state.kind).toBe('codeEntry'); // shown while the send is still in flight
    gate.resolve();
    await loading;
    expect(controller.state.kind).toBe('codeEntry');
  });

  it('does not re-send a code when one was mailed inside the cooldown', async () => {
    const { controller, restageAdoption } = makeController({
      adoptionPending: true,
      storageSeed: { winr_adoption_code_sent_at_com_test: String(Date.now() - 30_000) },
    });
    await controller.load();
    expect(restageAdoption).not.toHaveBeenCalled();
    expect(controller.state.kind).toBe('codeEntry');
  });

  it('re-sends once the last code is older than the cooldown, and stamps the send', async () => {
    const { controller, restageAdoption } = makeController({
      adoptionPending: true,
      storageSeed: { winr_adoption_code_sent_at_com_test: String(Date.now() - 11 * 60 * 1000) },
    });
    await controller.load();
    expect(restageAdoption).toHaveBeenCalledOnce();
    const stamped = Number((controller as unknown as { deps: { storage: { getItem: (k: string) => string | null } } }).deps.storage.getItem('winr_adoption_code_sent_at_com_test'));
    expect(Date.now() - stamped).toBeLessThan(5_000);
  });

  it('"Send a new code" ignores the cooldown — a person asking always gets one', async () => {
    const { controller, restageAdoption } = makeController({
      adoptionPending: true,
      storageSeed: { winr_adoption_code_sent_at_com_test: String(Date.now()) },
    });
    await controller.load();
    expect(restageAdoption).not.toHaveBeenCalled();
    await controller.resendVerificationCode();
    expect(restageAdoption).toHaveBeenCalledOnce();
    expect(controller.state.kind).toBe('codeEntry');
  });

  it('a dead code (too many attempts) mails a fresh one immediately, ignoring the cooldown', async () => {
    const { controller, restageAdoption } = makeController({
      adoptionPending: true,
      verifyError: new Error('resource-exhausted: Too many attempts. Enter your email again to get a new code.'),
      storageSeed: { winr_adoption_code_sent_at_com_test: String(Date.now()) },
    });
    await controller.load();
    expect(restageAdoption).not.toHaveBeenCalled(); // inside the cooldown, no auto-resend on open

    await controller.submitVerificationCode('000000');
    expect(restageAdoption).toHaveBeenCalledOnce(); // …but a dead code gets a fresh one right away
    expect(controller.state.kind).toBe('codeEntry');
    expect(controller.codeError).toBe(AvafliV2Strings.codeFreshSent);
  });
});
