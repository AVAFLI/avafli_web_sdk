import { describe, it, expect, vi } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { GetActiveGiveawayResponse, Giveaway } from '../src/types';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

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
    if (options.restageError) throw options.restageError;
    return { sent: true };
  });
  const verifyAdoptionCode = vi.fn(async () => {
    if (options.verifyError) throw options.verifyError;
    return { adopted: true };
  });
  const onAdoptionResolved = vi.fn();
  const deps: V2ControllerDeps = {
    api: api as unknown as WINRAPI,
    storage: fakeStorage({ winr_email_submitted_com_test: 'true' }),
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
});
