// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import { WINRV2Strings, isGeoBlockedError } from '../src/ui/v2/strings';
import { isValidClaimName, isValidClaimPhone } from '../src/ui/v2/claim';
import { renderCapture, renderDashboard } from '../src/ui/v2/screens';
import { Giveaway, WINRError, WINRErrorCode } from '../src/types';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * User-facing error messaging (Master Field List, "User Message (UI)").
 *
 *  - Fixed strings only — raw backend error text must never reach the UI.
 *  - Dedicated geo-blocked and session-expired states (never 'empty').
 *  - Honest failures: no fabricated claim success, no swallowed email submit.
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

// The two literal messages the backend's enforceGeoFence throws.
const GEO_NON_US =
  'This promotion is only available to users located in one of the 50 United States or Washington, D.C.';
const GEO_UNVERIFIED =
  "We couldn't verify your location. This promotion is only available in the United States.";

function fakeStorage(seed: Record<string, string> = {}): LocalStorageProvider {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

interface Options {
  claimError?: Error;
  streakDay?: number;
  loadError?: Error;
  submitEmailError?: Error;
  emailSubmitted?: boolean;
  claimedToday?: boolean;
  verificationRequired?: boolean;
  verifyError?: Error;
}

function makeController(options: Options = {}): {
  controller: V2ExperienceController;
  api: { getActiveGiveaway: ReturnType<typeof vi.fn>; claimDailyEntries: ReturnType<typeof vi.fn> };
  storage: LocalStorageProvider;
  submitEmailAndAdopt: ReturnType<typeof vi.fn>;
} {
  const api = {
    getActiveGiveaway: vi.fn(async () => {
      if (options.loadError) throw options.loadError;
      return {
        giveaway: GIVEAWAY,
        claimedToday: options.claimedToday === true,
        streakDay: options.streakDay ?? 3,
        totalEntries: 100,
        emailConsentStatus: options.emailSubmitted !== false,
      };
    }),
    claimDailyEntries: vi.fn(async () => {
      if (options.claimError) throw options.claimError;
      return { entries: 130, streakDay: 4, totalEntries: 230 };
    }),
  };
  const submitEmailAndAdopt = vi.fn(async () => {
    if (options.submitEmailError) throw options.submitEmailError;
    return options.verificationRequired ? { verificationRequired: true } : { success: true };
  });
  const storage = fakeStorage(
    options.emailSubmitted === false ? {} : { 'winr_email_submitted_com.test': 'true' }
  );
  const deps: V2ControllerDeps = {
    api: api as unknown as WINRAPI,
    storage,
    bundleId: 'com.test',
    submitEmailAndAdopt,
    verifyAdoptionCode: async () => {
      if (options.verifyError) throw options.verifyError;
      return {};
    },
    hasRegisteredUuid: () => true,
  };
  return { controller: new V2ExperienceController(deps), api, storage, submitEmailAndAdopt };
}

const CONSENT = { ageConfirmed: true, marketingConsent: false };

describe('claim-name / phone validators', () => {
  it('accepts unicode letters, spaces, apostrophes, hyphens, periods; max 50', () => {
    expect(isValidClaimName('Ada')).toBe(true);
    expect(isValidClaimName("O'Brien-Smith Jr.")).toBe(true);
    expect(isValidClaimName('Beyoncé')).toBe(true);
    expect(isValidClaimName('  ')).toBe(false);
    expect(isValidClaimName('Ada2')).toBe(false);
    expect(isValidClaimName('a@b')).toBe(false);
    expect(isValidClaimName('x'.repeat(51))).toBe(false);
    expect(isValidClaimName('x'.repeat(50))).toBe(true);
  });

  it('phone: blank allowed; otherwise digits must strip to 10 (leading 1 ok)', () => {
    expect(isValidClaimPhone('')).toBe(true);
    expect(isValidClaimPhone('+1 (212) 555-0100')).toBe(true);
    expect(isValidClaimPhone('212-555-0100')).toBe(true);
    expect(isValidClaimPhone('555')).toBe(false);
  });
});

describe('geo-blocked detection + dedicated state', () => {
  it('matches BOTH backend geo-fence messages and nothing generic', () => {
    expect(isGeoBlockedError(GEO_NON_US)).toBe(true);
    expect(isGeoBlockedError(GEO_UNVERIFIED)).toBe(true);
    expect(isGeoBlockedError('Failed to fetch')).toBe(false);
    expect(isGeoBlockedError('Already claimed today')).toBe(false);
  });

  it('a geo-rejected claim renders the geoBlocked state, not empty/dashboard', async () => {
    const { controller } = makeController({
      claimedToday: false,
      streakDay: 0, // Day-1 path: the claim is AWAITED
      claimError: new Error(GEO_NON_US),
    });
    await controller.load();
    expect(controller.state.kind).toBe('geoBlocked');
    expect(controller.claimedToday).toBe(false);
  });
});

describe('session expired', () => {
  it('an AuthenticationRequired load failure renders sessionExpired, not empty', async () => {
    const { controller } = makeController({
      loadError: new WINRError(
        WINRErrorCode.AuthenticationRequired,
        'Authentication failed and token refresh unsuccessful'
      ),
    });
    await controller.load();
    expect(controller.state.kind).toBe('sessionExpired');
  });

  it('RETRY re-runs the load and recovers', async () => {
    const error = new WINRError(WINRErrorCode.AuthenticationRequired, 'refresh failed');
    const { controller, api } = makeController({ claimedToday: true });
    api.getActiveGiveaway.mockRejectedValueOnce(error);
    await controller.load();
    expect(controller.state.kind).toBe('sessionExpired');

    controller.retryLoad();
    await vi.waitFor(() => expect(controller.state.kind).toBe('dashboard'));
    expect(api.getActiveGiveaway).toHaveBeenCalledTimes(2);
  });
});

describe('auto-claim failure honesty', () => {
  it('a transport failure shows the dashboard UNCLAIMED with the retryable notice', async () => {
    const { controller } = makeController({
      streakDay: 0,
      claimError: new Error('Failed to fetch'),
    });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.claimedToday).toBe(false);
    expect(controller.claimFailedNotice).toBe(true);

    const dash = renderDashboard(controller, null, () => {});
    const notice = dash.querySelector('.wv2-dash-notice-retry');
    expect(notice?.textContent).toContain(WINRV2Strings.claimRecordFailed);
    expect(notice?.textContent).toContain(WINRV2Strings.retry);
  });

  it('retryClaim() re-attempts and clears the notice on success', async () => {
    const { controller, api } = makeController({
      streakDay: 0,
      claimError: new Error('Failed to fetch'),
    });
    await controller.load();
    expect(controller.claimFailedNotice).toBe(true);

    api.claimDailyEntries.mockResolvedValueOnce({ entries: 10, streakDay: 1, totalEntries: 10 });
    await controller.retryClaim();
    expect(controller.claimedToday).toBe(true);
    expect(controller.claimFailedNotice).toBe(false);
    expect(controller.state.kind).toBe('dashboard');
  });

  it('an "already claimed" rejection sets the transient already-entered notice', async () => {
    const { controller } = makeController({
      streakDay: 0,
      claimError: new Error('Already claimed today'),
    });
    await controller.load();
    expect(controller.claimedToday).toBe(true);
    expect(controller.dashboardNotice).toBe(WINRV2Strings.alreadyEnteredToday);
    expect(controller.claimFailedNotice).toBe(false);
  });

  it('a normal open with claimedToday already known shows NO notice', async () => {
    const { controller } = makeController({ claimedToday: true });
    await controller.load();
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.dashboardNotice).toBeNull();
    const dash = renderDashboard(controller, null, () => {});
    expect(dash.querySelector('.wv2-dash-notice')).toBeNull();
  });

  it('the transient notice renders once and never replays', async () => {
    const { controller } = makeController({
      streakDay: 0,
      claimError: new Error('Already claimed today'),
    });
    await controller.load();

    const first = renderDashboard(controller, null, () => {});
    expect(first.querySelector('.wv2-dash-notice')?.textContent).toBe(
      WINRV2Strings.alreadyEnteredToday
    );
    const second = renderDashboard(controller, null, () => {});
    expect(second.querySelector('.wv2-dash-notice')).toBeNull();
  });
});

describe('email submit failure (no longer swallowed)', () => {
  it('stays on the capture screen with the inline error and does NOT set the submitted flag', async () => {
    const { controller, storage } = makeController({
      emailSubmitted: false,
      submitEmailError: new Error('Failed to fetch'),
    });
    await controller.load();
    expect(controller.state.kind).toBe('emailCapture');

    await controller.submitEmail('ada@example.com', CONSENT);
    expect(controller.state.kind).toBe('emailCapture');
    expect(controller.emailSubmitError).toBe(WINRV2Strings.emailSubmitFailed);
    expect(controller.isSubmittingEmail).toBe(false);
    expect(storage.getItem('winr_email_submitted_com.test')).toBeNull();

    // The capture render shows the same fixed string below the CTA.
    const capture = renderCapture(controller);
    const errors = capture.querySelectorAll('.wv2-field-error.wv2-visible');
    expect(Array.from(errors).map((n) => n.textContent)).toContain(
      WINRV2Strings.emailSubmitFailed
    );
  });

  it('a geo-fenced email submit routes to the geoBlocked state', async () => {
    const { controller } = makeController({
      emailSubmitted: false,
      submitEmailError: new Error(GEO_UNVERIFIED),
    });
    await controller.load();
    await controller.submitEmail('ada@example.com', CONSENT);
    expect(controller.state.kind).toBe('geoBlocked');
  });
});

describe('capture screen inline email validation', () => {
  function setup(): { capture: HTMLElement; input: HTMLInputElement; error: () => string } {
    const { controller } = makeController({ emailSubmitted: false });
    const capture = renderCapture(controller);
    const input = capture.querySelector<HTMLInputElement>('.wv2-email-input')!;
    const error = (): string =>
      capture.querySelector('.wv2-field-error.wv2-visible')?.textContent ?? '';
    return { capture, input, error };
  }

  it('never shows the error while typing the first characters', () => {
    const { input, error } = setup();
    input.value = 'ad';
    input.dispatchEvent(new Event('input'));
    expect(error()).toBe('');
  });

  it('shows the exact message after blurring a non-empty invalid value, and live-clears', () => {
    const { input, error } = setup();
    input.value = 'not-an-email';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    expect(error()).toBe(WINRV2Strings.emailInvalid);

    input.value = 'ada@example.com';
    input.dispatchEvent(new Event('input'));
    expect(error()).toBe('');
  });

  it('a blur with an EMPTY value does not flag the field', () => {
    const { input, error } = setup();
    input.dispatchEvent(new Event('blur'));
    expect(error()).toBe('');
  });

  it('a tap on the dimmed CTA counts as a submit attempt and surfaces the message', () => {
    const { capture, input, error } = setup();
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    const wrap = capture.querySelector('.wv2-cta-catch')!;
    wrap.dispatchEvent(new Event('click'));
    expect(error()).toBe(WINRV2Strings.emailInvalid);
    // The CTA stays dimmed AND disabled — dimming behavior is kept.
    expect(capture.querySelector<HTMLButtonElement>('.wv2-pill')!.disabled).toBe(true);
  });
});

describe('verification-code screen error copy', () => {
  async function toCodeEntry(options: Options): Promise<V2ExperienceController> {
    const { controller } = makeController({
      ...options,
      emailSubmitted: false,
      verificationRequired: true,
    });
    await controller.load();
    await controller.submitEmail('ada@example.com', CONSENT);
    expect(controller.state.kind).toBe('codeEntry');
    return controller;
  }

  it('never renders raw backend text — expired / attempts / mismatch map to fixed strings', async () => {
    const cases: Array<[string, string]> = [
      ['deadline-exceeded: verification code expired at 2026-08-10T12:00:00Z', WINRV2Strings.codeExpired],
      ['resource-exhausted: too many attempts (5/5) for uid 4f3a', WINRV2Strings.codeTooManyAttempts],
      ['invalid-argument: code mismatch for pending adoption f81d', WINRV2Strings.codeIncorrect],
    ];
    for (const [raw, expected] of cases) {
      const controller = await toCodeEntry({ verifyError: new Error(raw) });
      await controller.submitVerificationCode('123456');
      expect(controller.codeError).toBe(expected);
      expect(controller.codeError).not.toContain('uid');
      expect(controller.state.kind).toBe('codeEntry');
    }
  });

  it('a failed RESEND stays on the code screen with the resend error in the code slot', async () => {
    const controller = await toCodeEntry({});
    // Next submitEmailAndAdopt call (the resend) fails.
    const deps = (controller as unknown as { deps: V2ControllerDeps }).deps;
    deps.submitEmailAndAdopt = async () => {
      throw new Error('Failed to fetch');
    };
    await controller.resendVerificationCode();
    expect(controller.state.kind).toBe('codeEntry');
    expect(controller.codeError).toBe(WINRV2Strings.codeResendFailed);
  });

  it('a successful RESEND stays on the code screen with no error', async () => {
    const controller = await toCodeEntry({});
    await controller.resendVerificationCode();
    expect(controller.state.kind).toBe('codeEntry');
    expect(controller.codeError).toBeNull();
  });
});
