// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_MARKETING_CONSENT_TEXT,
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
 * default, gates the CTA) and MARKETING consent (UNCHECKED — consent must be an
 * affirmative act; pre-ticked boxes are invalid under GDPR — and never a
 * gate — unchecking it must still let the user enter, and never affects
 * winner contact). Both values travel to `submitEmail` as `ageConfirmed` /
 * `marketingConsent`.
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

function makeController(
  sdkConfig?: SDKConfig,
  userPrefill?: { firstName?: string; lastName?: string; email?: string }
): {
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
    ...(userPrefill ? { userPrefill } : {}),
  };
  const controller = new V2ExperienceController(deps);
  controller.giveaway = GIVEAWAY;
  if (sdkConfig) controller.sdkConfig = sdkConfig;
  return { controller, submitEmailAndAdopt };
}

/** [age gate, marketing consent] — the capture screen's two rows, in order. */
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
  it('renders BOTH the age gate and marketing consent UNCHECKED, in that order', () => {
    // Marketing was pre-checked until Aug 2026. Changed on governance review:
    // consent must be an affirmative act (pre-ticked boxes are invalid under
    // GDPR and disfavored by US state regulators).
    const { controller } = makeController();
    const capture = renderCapture(controller);
    const [age, consent] = consentRows(capture);

    expect(consentRows(capture).length).toBe(2);
    expect(age!.textContent).toContain('18 years of age or older');
    expect(age!.getAttribute('aria-checked')).toBe('false');

    expect(consent!.textContent).toContain(DEFAULT_MARKETING_CONSENT_TEXT);
    expect(consent!.getAttribute('aria-checked')).toBe('false');

    // Same class => same box size, check treatment, spacing and text style.
    expect(consent!.className).toBe(age!.className);
    // …and the consent row sits directly BELOW the age row.
    expect(age!.nextElementSibling).toBe(consent!);
  });

  it('prefers the nested copy override, then the flat one, over the default', () => {
    expect(makeController().controller.marketingConsentText).toBe(DEFAULT_MARKETING_CONSENT_TEXT);

    expect(
      makeController({ copy: { emailConsentText: 'Flat consent copy' } }).controller
        .marketingConsentText
    ).toBe('Flat consent copy');

    expect(
      makeController({
        copy: {
          emailConsentText: 'Flat consent copy',
          emailCapture: { emailConsentText: 'Nested consent copy' },
        },
      }).controller.marketingConsentText
    ).toBe('Nested consent copy');
  });

  it('the CTA is gated on the age gate + a valid email ONLY — never on marketing consent', () => {
    const { controller } = makeController();
    const capture = renderCapture(controller);
    const [age, consent] = consentRows(capture);

    expect(cta(capture).disabled).toBe(true);

    typeEmail(capture, 'ada@example.com');
    expect(cta(capture).disabled).toBe(true); // age gate still unchecked

    age!.dispatchEvent(new Event('click'));
    expect(cta(capture).disabled).toBe(false);

    // Marketing consent must not gate the CTA in either state: leaving it
    // unchecked costs nothing, and checking it changes nothing about entry.
    consent!.dispatchEvent(new Event('click'));
    expect(consent!.getAttribute('aria-checked')).toBe('true');
    expect(cta(capture).disabled).toBe(false);
    expect(cta(capture).classList.contains('wv2-pill-dim')).toBe(false);

    // …and unchecking the age gate re-disables it.
    age!.dispatchEvent(new Event('click'));
    expect(cta(capture).disabled).toBe(true);
  });

  it('an untouched marketing box submits FALSE — silence is not consent', async () => {
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
      marketingConsent: false,
    });
    // The payload key is `marketingConsent` — the interim `emailConsent`
    // name is gone from the wire entirely.
    const payload = submitEmailAndAdopt.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['ageConfirmed', 'email', 'marketingConsent']);
    expect('emailConsent' in payload).toBe(false);
  });

  it('carries marketingConsent: true only after the user affirmatively checks it', async () => {
    const { controller, submitEmailAndAdopt } = makeController();
    const capture = renderCapture(controller);
    const [age, consent] = consentRows(capture);

    typeEmail(capture, 'ada@example.com');
    age!.dispatchEvent(new Event('click'));
    consent!.dispatchEvent(new Event('click'));   // the affirmative act
    cta(capture).dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(submitEmailAndAdopt).toHaveBeenCalled());

    expect(submitEmailAndAdopt).toHaveBeenCalledWith({
      email: 'ada@example.com',
      ageConfirmed: true,
      marketingConsent: true,
    });
  });
});

describe('partner-supplied email pre-fill', () => {
  const emailInput = (capture: HTMLElement): HTMLInputElement =>
    capture.querySelector('.wv2-email-input') as HTMLInputElement;

  it('renders the partner email READ-ONLY, normalized, and submits it', async () => {
    const { controller, submitEmailAndAdopt } = makeController(undefined, {
      email: '  Ada@Example.COM ',
    });
    const capture = renderCapture(controller);
    const input = emailInput(capture);

    // Visible (informed consent) but not editable, and normalized like the
    // server will store it.
    expect(input.value).toBe('ada@example.com');
    expect(input.readOnly).toBe(true);

    const [age] = consentRows(capture);
    age!.dispatchEvent(new Event('click'));
    expect(cta(capture).disabled).toBe(false);   // locked email already satisfies the gate

    cta(capture).dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(submitEmailAndAdopt).toHaveBeenCalled());
    expect(submitEmailAndAdopt).toHaveBeenCalledWith({
      email: 'ada@example.com',
      ageConfirmed: true,
      marketingConsent: false,
    });
  });

  it('a malformed partner email degrades to the editable field', () => {
    // A partner bug must not lock garbage into a read-only field.
    const { controller } = makeController(undefined, { email: 'not-an-email' });
    const capture = renderCapture(controller);
    const input = emailInput(capture);
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe('');
  });

  it('no partner email → the field is editable, unchanged', () => {
    const { controller } = makeController();
    const input = emailInput(renderCapture(controller));
    expect(input.readOnly).toBe(false);
  });
});
