import { describe, it, expect, vi } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import {
  GetActiveGiveawayResponse,
  Giveaway,
  PrizeClaimBlock,
  SubmitPrizeClaimResponse,
} from '../src/types';
import {
  PrizeClaimForm,
  hasAllConsents,
  isClaimFormValid,
  isStep1Valid,
  isStep2Valid,
} from '../src/ui/v2/claim';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Winner prize-claim routing (parity with iOS WINRExperienceViewModel):
 *  - prizeClaim.status "pending" takes precedence over the dashboard AND the
 *    email gate on open (splash → form → confirmation), even when the
 *    giveaway is null (a pending claim can outlive its giveaway).
 *  - The daily auto-claim still fires silently while the winner flow is up.
 *  - "submitted" is ignored — the normal dashboard shows.
 *  - A backend "Not the winner"/"Already submitted" rejection suppresses the
 *    winner flow and silently re-loads onto the dashboard; transport failures
 *    stay on the form with an inline error.
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

const PENDING_CLAIM: PrizeClaimBlock = {
  status: 'pending',
  giveawayId: 'g1',
  prizeDescription: 'Cash Prize',
  prizeValue: 1000,
  maskedEmail: 'a********e@winr.example.com',
};

const VALID_FORM: PrizeClaimForm = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '',
  street: '12 Analytical Way',
  apt: '',
  city: 'Brooklyn',
  state: 'New York',
  zip: '11201',
  story: '',
  confirmsAccuracy: true,
  authorizesLikeness: true,
  agreesToRules: true,
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

interface MockApi {
  getActiveGiveaway: ReturnType<typeof vi.fn>;
  claimDailyEntries: ReturnType<typeof vi.fn>;
  submitPrizeClaim: ReturnType<typeof vi.fn>;
}

function makeController(options: {
  giveawayResponse?: Partial<GetActiveGiveawayResponse>;
  submitResponse?: SubmitPrizeClaimResponse;
  submitError?: Error;
  emailSubmitted?: boolean;
  hasUuid?: boolean;
}): { controller: V2ExperienceController; api: MockApi } {
  const giveawayResponse: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY,
    claimedToday: false,
    streakDay: 3,
    totalEntries: 100,
    emailConsentStatus: options.emailSubmitted !== false,
    ...options.giveawayResponse,
  };
  const api: MockApi = {
    getActiveGiveaway: vi.fn(async () => giveawayResponse),
    claimDailyEntries: vi.fn(async () => ({ entries: 60, streakDay: 4, totalEntries: 160 })),
    submitPrizeClaim: vi.fn(async () => {
      if (options.submitError) throw options.submitError;
      return (
        options.submitResponse ?? {
          claimNumber: 'WNR-2026-0042',
          submittedAt: '2026-08-04T15:00:00Z',
        }
      );
    }),
  };
  const seed: Record<string, string> = {};
  if (options.emailSubmitted !== false) seed['winr_email_submitted_com.test'] = 'true';
  const deps: V2ControllerDeps = {
    api: api as unknown as WINRAPI,
    storage: fakeStorage(seed),
    bundleId: 'com.test',
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => options.hasUuid !== false,
    userPrefill: { firstName: 'Ada', lastName: 'Lovelace' },
  };
  return { controller: new V2ExperienceController(deps), api };
}

/** Let fire-and-forget promises (silent daily claim) settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Winner prize-claim routing', () => {
  it('pending prizeClaim opens the winner splash instead of the dashboard', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { prizeClaim: PENDING_CLAIM },
    });
    await controller.load();

    expect(controller.state.kind).toBe('winnerClaim');
    if (controller.state.kind === 'winnerClaim') {
      expect(controller.state.claim).toEqual(PENDING_CLAIM);
    }
    expect(controller.winnerClaimStep.kind).toBe('splash');

    // The daily auto-claim still fired silently — no reveal, state unchanged.
    await flush();
    expect(api.claimDailyEntries).toHaveBeenCalledOnce();
    expect(controller.claimedToday).toBe(true);
    expect(controller.state.kind).toBe('winnerClaim');
    expect(controller.pendingRevealGrant).toBeNull();
  });

  it('pending prizeClaim routes BEFORE the email-capture gate (no silent claim without consent)', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { prizeClaim: PENDING_CLAIM, emailConsentStatus: false },
      emailSubmitted: false,
      hasUuid: false,
    });
    await controller.load();

    expect(controller.state.kind).toBe('winnerClaim');
    await flush();
    // No email consent → the silent claim must NOT fire (backend would reject).
    expect(api.claimDailyEntries).not.toHaveBeenCalled();
  });

  it('pending prizeClaim outlives its giveaway (giveaway: null still shows the winner flow)', async () => {
    const { controller } = makeController({
      giveawayResponse: { giveaway: null, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();

    expect(controller.state.kind).toBe('winnerClaim');
  });

  it('a "submitted" prizeClaim is ignored — the normal dashboard shows', async () => {
    const { controller } = makeController({
      giveawayResponse: {
        claimedToday: true,
        prizeClaim: {
          ...PENDING_CLAIM,
          status: 'submitted',
          claimNumber: 'WNR-2026-0001',
          submittedAt: '2026-08-01T12:00:00Z',
        },
      },
    });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
  });

  it('splash → form → confirmation on successful submit', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    expect(controller.winnerClaimStep.kind).toBe('splash');

    controller.winnerClaimContinue();
    expect(controller.winnerClaimStep.kind).toBe('form');

    await controller.submitPrizeClaim(VALID_FORM);
    expect(controller.winnerClaimStep).toEqual({
      kind: 'confirmation',
      claimNumber: 'WNR-2026-0042',
      submittedAt: '2026-08-04T15:00:00Z',
    });
    expect(controller.submittedClaimForm).toEqual(VALID_FORM);
    expect(controller.claimSubmitError).toBeNull();

    // Exact backend payload: fixed US country, empty optionals omitted.
    expect(api.submitPrizeClaim).toHaveBeenCalledWith({
      giveawayId: 'g1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      street: '12 Analytical Way',
      city: 'Brooklyn',
      state: 'New York',
      zip: '11201',
      country: 'United States',
    });
  });

  it('an invalid form never reaches the network', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim({ ...VALID_FORM, zip: '123' });
    expect(api.submitPrizeClaim).not.toHaveBeenCalled();
    expect(controller.winnerClaimStep.kind).toBe('form');
  });

  it('missing consents block the submit (likeness release must be affirmative)', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim({ ...VALID_FORM, authorizesLikeness: false });
    expect(api.submitPrizeClaim).not.toHaveBeenCalled();
    expect(controller.winnerClaimStep.kind).toBe('form');
  });

  it('a non-empty story is sent trimmed; an empty one is omitted', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim({ ...VALID_FORM, story: '  Buying a telescope!  ' });
    expect(api.submitPrizeClaim).toHaveBeenCalledWith(
      expect.objectContaining({ story: 'Buying a telescope!' })
    );
  });

  it('"Already submitted" rejection suppresses the winner flow and falls back to the dashboard', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
      submitError: new Error('already-exists: Already submitted'),
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim(VALID_FORM);

    // Silent fallback: re-loaded, and the (still-pending) block was skipped.
    expect(api.getActiveGiveaway).toHaveBeenCalledTimes(2);
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.claimSubmitError).toBeNull();
  });

  it('"Not the winner" rejection also falls back silently', async () => {
    const { controller } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
      submitError: new Error('permission-denied: Not the winner'),
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim(VALID_FORM);
    expect(controller.state.kind).toBe('dashboard');
  });

  it('per-step validity gates match the iOS stepped flow', () => {
    // Step 1: names required; optional phone must be empty or a US number.
    expect(isStep1Valid(VALID_FORM)).toBe(true);
    expect(isStep1Valid({ ...VALID_FORM, firstName: ' ' })).toBe(false);
    expect(isStep1Valid({ ...VALID_FORM, phone: '555' })).toBe(false);
    expect(isStep1Valid({ ...VALID_FORM, phone: '+1 (212) 555-0100' })).toBe(true);

    // Step 2: full US shipping address with a 5-digit zip.
    expect(isStep2Valid(VALID_FORM)).toBe(true);
    expect(isStep2Valid({ ...VALID_FORM, state: '' })).toBe(false);
    expect(isStep2Valid({ ...VALID_FORM, zip: '1120' })).toBe(false);

    // Review: all three consents required for the overall form validity.
    expect(hasAllConsents(VALID_FORM)).toBe(true);
    expect(isClaimFormValid({ ...VALID_FORM, agreesToRules: false })).toBe(false);
    // Steps 3/4 (photo, story) are optional — validity ignores them.
    expect(isClaimFormValid({ ...VALID_FORM, story: '', photoBase64: undefined })).toBe(true);
  });

  it('a transport failure stays on the form with an inline error', async () => {
    const { controller } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
      submitError: new Error('Failed to fetch'),
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim(VALID_FORM);
    expect(controller.state.kind).toBe('winnerClaim');
    expect(controller.winnerClaimStep.kind).toBe('form');
    expect(controller.claimSubmitError).toMatch(/check your connection/i);
    expect(controller.isSubmittingClaim).toBe(false);
  });
});
