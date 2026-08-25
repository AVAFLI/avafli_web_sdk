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
  US_STATES,
  emptyClaimForm,
  isClaimFormValid,
  isStep1Valid,
  isStep2Valid,
  likenessConsentText,
} from '../src/ui/v2/claim';
import { AvafliAPI } from '../src/network/api';
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
  maskedEmail: 'a********e@avafli.example.com',
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
  authorizesLikeness: true,
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
  attachStoryError?: Error;
}): {
  controller: V2ExperienceController;
  api: MockApi;
  attachClaimStory: ReturnType<typeof vi.fn>;
} {
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
  const attachClaimStory = vi.fn(async () => {
    if (options.attachStoryError) throw options.attachStoryError;
    return { saved: true };
  });
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage: fakeStorage(seed),
    bundleId: 'com.test',
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => options.hasUuid !== false,
    userPrefill: { firstName: 'Ada', lastName: 'Lovelace' },
    attachClaimStory,
  };
  return { controller: new V2ExperienceController(deps), api, attachClaimStory };
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

  it('splash → form → share → confirmation on successful submit (2.9 order)', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    expect(controller.winnerClaimStep.kind).toBe('splash');

    controller.winnerClaimContinue();
    expect(controller.winnerClaimStep.kind).toBe('form');

    // The claim is submitted FIRST — the share step comes after and never
    // gates it.
    await controller.submitPrizeClaim(VALID_FORM);
    expect(controller.winnerClaimStep).toEqual({
      kind: 'share',
      claimNumber: 'WNR-2026-0042',
      submittedAt: '2026-08-04T15:00:00Z',
    });
    expect(controller.submittedClaimForm).toEqual(VALID_FORM);
    expect(controller.claimSubmitError).toBeNull();

    // Exact backend payload: fixed US country, empty optionals omitted, and
    // the optional likeness consent reported as promoConsentGranted.
    expect(api.submitPrizeClaim).toHaveBeenCalledWith({
      giveawayId: 'g1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      street: '12 Analytical Way',
      city: 'Brooklyn',
      state: 'New York',
      zip: '11201',
      country: 'United States',
      promoConsentGranted: true,
    });

    // CONTINUE on the share step → confirmation, claim untouched.
    controller.winnerShareContinue();
    expect(controller.winnerClaimStep).toEqual({
      kind: 'confirmation',
      claimNumber: 'WNR-2026-0042',
      submittedAt: '2026-08-04T15:00:00Z',
    });
    expect(api.submitPrizeClaim).toHaveBeenCalledOnce();
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

  it('the likeness consent is OPTIONAL (2.9): unticked still submits, reported as promoConsentGranted: false', async () => {
    const { controller, api } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim({ ...VALID_FORM, authorizesLikeness: false });
    expect(api.submitPrizeClaim).toHaveBeenCalledWith(
      expect.objectContaining({ promoConsentGranted: false })
    );
    expect(controller.winnerClaimStep.kind).toBe('share');
  });

  it('the likeness consent starts UNCHECKED (affirmative act) and never gates validity', () => {
    // 2.9: the accuracy + rules checkboxes are gone; the one remaining
    // (likeness) consent defaults OFF and SUBMIT does not wait on it.
    expect(emptyClaimForm().authorizesLikeness).toBe(false);

    const { controller } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    const prefill = controller.claimFormPrefill;
    expect(prefill.authorizesLikeness).toBe(false);

    // With names prefilled, only the address is needed for full validity —
    // regardless of the consent state.
    const complete = { ...prefill, street: '1 Main St', city: 'Troy', state: 'New York', zip: '12180' };
    expect(isClaimFormValid(complete)).toBe(true);
    expect(isClaimFormValid({ ...complete, authorizesLikeness: true })).toBe(true);
  });

  it('the story rides attachClaimStory (post-submit), never the claim payload (2.9)', async () => {
    const { controller, api, attachClaimStory } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();

    await controller.submitPrizeClaim(VALID_FORM);
    // No story key on the submit payload anymore.
    expect(api.submitPrizeClaim).toHaveBeenCalledWith(
      expect.not.objectContaining({ story: expect.anything() })
    );

    // The user types a story on the post-submit share step; DONE attaches it
    // trimmed via the new callable.
    controller.claimStoryDraft = '  Buying a telescope!  ';
    controller.winnerShareContinue();
    await flush();
    expect(attachClaimStory).toHaveBeenCalledWith({ story: 'Buying a telescope!' });
    expect(attachClaimStory).toHaveBeenCalledOnce();
    expect(controller.winnerClaimStep.kind).toBe('confirmation');
  });

  it('an empty story never calls attachClaimStory; a typed one is flushed at most once', async () => {
    const { controller, attachClaimStory } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();
    await controller.submitPrizeClaim(VALID_FORM);

    // Nothing typed → DONE sends nothing.
    controller.winnerShareContinue();
    await flush();
    expect(attachClaimStory).not.toHaveBeenCalled();
  });

  it('a story typed before a dismissal is flushed by flushClaimStory (X/backdrop/Escape path), once', async () => {
    const { controller, attachClaimStory } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
    });
    await controller.load();
    controller.winnerClaimContinue();
    await controller.submitPrizeClaim(VALID_FORM);

    controller.claimStoryDraft = 'A trip with my kids';
    // The root's dismiss() invokes this on every close path.
    controller.flushClaimStory();
    controller.flushClaimStory(); // double-close must not double-send
    await flush();
    expect(attachClaimStory).toHaveBeenCalledOnce();
    expect(attachClaimStory).toHaveBeenCalledWith({ story: 'A trip with my kids' });
  });

  it('attachClaimStory failures retry once and never surface an error', async () => {
    const { controller, attachClaimStory } = makeController({
      giveawayResponse: { claimedToday: true, prizeClaim: PENDING_CLAIM },
      attachStoryError: new Error('Failed to fetch'),
    });
    await controller.load();
    controller.winnerClaimContinue();
    await controller.submitPrizeClaim(VALID_FORM);

    controller.claimStoryDraft = 'Story that will fail';
    controller.winnerShareContinue();
    await flush();
    // One retry, then give up quietly — the flow moved on regardless.
    expect(attachClaimStory).toHaveBeenCalledTimes(2);
    expect(controller.winnerClaimStep.kind).toBe('confirmation');
    expect(controller.claimSubmitError).toBeNull();
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

    // Review (2.9): the optional likeness consent never affects validity.
    expect(isClaimFormValid({ ...VALID_FORM, authorizesLikeness: false })).toBe(true);
    // The photo is optional — validity ignores it.
    expect(isClaimFormValid({ ...VALID_FORM, photoBase64: undefined })).toBe(true);
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

describe('claim state list', () => {
  it('covers the 50 states plus the District of Columbia, alphabetically', () => {
    // The official rules promise "50 states and the District of Columbia".
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES).size).toBe(51);
    expect(US_STATES).toContain('District of Columbia');
    // Alphabetical placement: between Delaware and Florida.
    expect(US_STATES.indexOf('District of Columbia')).toBe(US_STATES.indexOf('Delaware') + 1);
    expect(US_STATES.indexOf('Florida')).toBe(US_STATES.indexOf('District of Columbia') + 1);
    expect([...US_STATES].sort()).toEqual([...US_STATES]);
  });
});

describe('likeness consent copy (2.9.4)', () => {
  it('names the actual publisher when a name is available', () => {
    expect(likenessConsentText('Rumble')).toBe(
      'I authorize Rumble and its promotional partners to use my name, city, ' +
        'profile photo, and likeness for winner announcements and promotional ' +
        'purposes. (Optional)'
    );
    // Whitespace-only names do not count as a name.
    expect(likenessConsentText('  Rumble  ')).toContain('I authorize Rumble and');
  });

  it('falls back to the generic wording when no name is available', () => {
    for (const name of [null, undefined, '', '   ']) {
      expect(likenessConsentText(name)).toBe(
        "I authorize this app's publisher and its promotional partners to use " +
          'my name, city, profile photo, and likeness for winner announcements ' +
          'and promotional purposes. (Optional)'
      );
    }
  });

  it('controller.publisherName prefers the server-fed sdkConfig.appName', () => {
    const { controller } = makeController({});
    controller.sdkConfig = { appName: '  Rumble  ' };
    expect(controller.publisherName).toBe('Rumble');

    // No server name and no DOM (node test env): null → generic copy.
    controller.sdkConfig = {};
    expect(controller.publisherName).toBeNull();
    controller.sdkConfig = null;
    expect(controller.publisherName).toBeNull();
  });
});
