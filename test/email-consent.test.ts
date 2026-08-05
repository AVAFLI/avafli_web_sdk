// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_EMAIL_CONSENT_TEXT,
  V2ControllerDeps,
  V2ExperienceController,
} from '../src/ui/v2/controller';
import { renderCapture } from '../src/ui/v2/screens';
import { Giveaway, SDKConfig, SubmitEmailRequest } from '../src/types';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Capture-screen consent (2.4.0).
 *
 * The capture screen carries TWO checkboxes: the 18+ age gate (unchecked by
 * default, gates the CTA) and email/marketing consent (PRE-CHECKED, and never
 * a gate — unchecking it must still let the user enter). Both values travel
 * to `submitEmail` as `ageConfirmed` / `emailConsent`.
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

function fakeStorage(): LocalStorageProvider {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function makeController(sdkConfig?: SDKConfig): {
  controller: V2ExperienceController;
  submitEmailAndAdopt: ReturnType<typeof vi.fn>;
} {
  const submitEmailAndAdopt = vi.fn(async (_request: SubmitEmailRequest) => ({ success: true }));
  const api = {
    // The post-submit reload lands on a fresh (still unconsented) response so
    // the capture screen is the only thing exercised here.
    getActiveGiveaway: vi.fn(async () => ({
      giveaway: GIVEAWAY,
      claimedToday: true,
      streakDay: 0,
      totalEntries: 0,
      emailConsentStatus: false,
    })),
    claimDailyEntries: vi.fn(async () => ({ entries: 10, streakDay: 1, totalEntries: 10 })),
  };
  const deps: V2ControllerDeps = {
    api: api as unknown as WINRAPI,
    storage: fakeStorage(),
    bundleId: 'com.test',
    submitEmailAndAdopt,
    hasRegisteredUuid: () => true,
  };
  const controller = new V2ExperienceController(deps);
  controller.giveaway = GIVEAWAY;
  if (sdkConfig) controller.sdkConfig = sdkConfig;
  return { controller, submitEmailAndAdopt };
}

/** [age gate, email consent] — the capture screen's two consent rows, in order. */
function consentRows(capture: HTMLElement): HTMLButtonElement[] {
  return Array.from(capture.querySelectorAll<HTMLButtonElement>('.wv2-age-row'));
}

const cta = (capture: HTMLElement): HTMLButtonElement =>
  capture.querySelector<HTMLButtonElement>('.wv2-pill')!;

const emailInput = (capture: HTMLElement): HTMLInputElement =>
  capture.querySelector<HTMLInputElement>('.wv2-email-input')!;

function typeEmail(capture: HTMLElement, value: string): void {
  const input = emailInput(capture);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('capture screen consent checkboxes', () => {
  it('renders the age gate UNCHECKED and email consent PRE-CHECKED, below it', () => {
    const { controller } = makeController();
    const capture = renderCapture(controller);
    const [age, consent] = consentRows(capture);

    expect(consentRows(capture).length).toBe(2);
    expect(age!.textContent).toContain('18 years of age or older');
    expect(age!.getAttribute('aria-checked')).toBe('false');

    expect(consent!.textContent).toContain(DEFAULT_EMAIL_CONSENT_TEXT);
    expect(consent!.getAttribute('aria-checked')).toBe('true');

    // Same class => same box size, check treatment, spacing and text style.
    expect(consent!.className).toBe(age!.className);
    // …and the consent row sits directly BELOW the age row.
    expect(age!.nextElementSibling).toBe(consent!);
  });

  it('prefers the nested copy override, then the flat one, over the default', () => {
    expect(makeController().controller.emailConsentText).toBe(DEFAULT_EMAIL_CONSENT_TEXT);

    expect(
      makeController({ copy: { emailConsentText: 'Flat consent copy' } }).controller
        .emailConsentText
    ).toBe('Flat consent copy');

    expect(
      makeController({
        copy: {
          emailConsentText: 'Flat consent copy',
          emailCapture: { emailConsentText: 'Nested consent copy' },
        },
      }).controller.emailConsentText
    ).toBe('Nested consent copy');
  });

  it('the CTA is gated on the age gate + a valid email ONLY — never on email consent', () => {
    const { controller } = makeController();
    const capture = renderCapture(controller);
    const [age, consent] = consentRows(capture);

    expect(cta(capture).disabled).toBe(true);

    typeEmail(capture, 'ada@example.com');
    expect(cta(capture).disabled).toBe(true); // age gate still unchecked

    age!.dispatchEvent(new Event('click'));
    expect(cta(capture).disabled).toBe(false);

    // Opting OUT of marketing email must not cost the user their entry.
    consent!.dispatchEvent(new Event('click'));
    expect(consent!.getAttribute('aria-checked')).toBe('false');
    expect(cta(capture).disabled).toBe(false);
    expect(cta(capture).classList.contains('wv2-pill-dim')).toBe(false);

    // …and unchecking the age gate re-disables it.
    age!.dispatchEvent(new Event('click'));
    expect(cta(capture).disabled).toBe(true);
  });

  it('submits the REAL checkbox states as ageConfirmed / emailConsent', async () => {
    const { controller, submitEmailAndAdopt } = makeController();
    const capture = renderCapture(controller);
    const [age] = consentRows(capture);

    typeEmail(capture, 'ada@example.com');
    age!.dispatchEvent(new Event('click'));
    cta(capture).dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(submitEmailAndAdopt).toHaveBeenCalled());

    expect(submitEmailAndAdopt).toHaveBeenCalledWith({
      email: 'ada@example.com',
      ageConfirmed: true,
      emailConsent: true,
      marketingConsent: true,
    });
  });

  it('carries emailConsent: false when the user unchecks it', async () => {
    const { controller, submitEmailAndAdopt } = makeController();
    const capture = renderCapture(controller);
    const [age, consent] = consentRows(capture);

    typeEmail(capture, 'ada@example.com');
    age!.dispatchEvent(new Event('click'));
    consent!.dispatchEvent(new Event('click'));
    cta(capture).dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(submitEmailAndAdopt).toHaveBeenCalled());

    expect(submitEmailAndAdopt).toHaveBeenCalledWith({
      email: 'ada@example.com',
      ageConfirmed: true,
      emailConsent: false,
      marketingConsent: false,
    });
  });
});
