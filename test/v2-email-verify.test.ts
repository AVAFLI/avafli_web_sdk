// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import { renderDashboard, renderEmailVerify } from '../src/ui/v2/screens';
import { AvafliV2Strings } from '../src/ui/v2/strings';
import { Giveaway, GetActiveGiveawayResponse } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Soft email verification (2.7.0).
 *
 * The register/status + submitEmail responses carry an optional
 * `emailVerified` boolean. Only an explicit `false` (a brand-new, unconfirmed
 * email) marks the user unverified and shows the persistent "Verify your
 * email" chip on the dashboard. The chip NEVER gates play — it opens the
 * reused 6-digit code screen, which is fully dismissible.
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
  // Consent already given so load() lands on the dashboard, not email capture.
  store.set('winr_email_submitted_com.test', 'true');
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function makeController(status: Partial<GetActiveGiveawayResponse>): {
  controller: V2ExperienceController;
  confirmEmailVerification: ReturnType<typeof vi.fn>;
  resendEmailVerification: ReturnType<typeof vi.fn>;
} {
  const confirmEmailVerification = vi.fn(async (_r: { code: string }) => ({ verified: true }));
  const resendEmailVerification = vi.fn(async () => ({ sent: true }));
  const api = {
    getActiveGiveaway: vi.fn(async () => ({
      giveaway: GIVEAWAY,
      claimedToday: true, // already claimed → straight to the dashboard
      streakDay: 3,
      totalEntries: 100,
      emailConsentStatus: true,
      ...status,
    })),
    claimDailyEntries: vi.fn(async () => ({ entries: 10, streakDay: 3, totalEntries: 110 })),
  };
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage: fakeStorage(),
    bundleId: 'com.test',
    submitEmailAndAdopt: vi.fn(async () => ({ success: true })),
    hasRegisteredUuid: () => true,
    confirmEmailVerification,
    resendEmailVerification,
  };
  const controller = new V2ExperienceController(deps);
  return { controller, confirmEmailVerification, resendEmailVerification };
}

const chip = (dash: HTMLElement): HTMLButtonElement | null =>
  dash.querySelector<HTMLButtonElement>('.wv2-verify-chip');

describe('soft email-verification chip', () => {
  it('shows the chip when emailVerified === false', async () => {
    const { controller } = makeController({ emailVerified: false });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.unverified).toBe(true);

    const dash = renderDashboard(controller, null, () => {});
    const el = chip(dash);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain(AvafliV2Strings.verifyEmailChip);
  });

  it('hides the chip when emailVerified is absent (verified/partner/no-email)', async () => {
    const { controller } = makeController({}); // no emailVerified field
    await controller.load();

    expect(controller.unverified).toBe(false);
    expect(chip(renderDashboard(controller, null, () => {}))).toBeNull();
  });

  it('hides the chip when emailVerified === true', async () => {
    const { controller } = makeController({ emailVerified: true });
    await controller.load();

    expect(controller.unverified).toBe(false);
    expect(chip(renderDashboard(controller, null, () => {}))).toBeNull();
  });

  it('tapping the chip opens the reused code screen with the verify copy', async () => {
    const { controller } = makeController({ emailVerified: false });
    await controller.load();

    chip(renderDashboard(controller, null, () => {}))!.dispatchEvent(new Event('click'));
    expect(controller.state.kind).toBe('emailVerify');

    const screen = renderEmailVerify(controller, null);
    expect(screen.querySelector('.wv2-capture-title')!.textContent).toBe(
      AvafliV2Strings.verifyEmailTitle
    );
    expect(screen.querySelector('.wv2-code-sub')!.textContent).toBe(
      AvafliV2Strings.verifyEmailSubtitle
    );
    // Reuses the exact 6-digit input from the adoption screen.
    expect(screen.querySelector('.wv2-code-input')).not.toBeNull();
    // Dismissible: the header carries a back control (adoption gate does not).
    expect(screen.querySelector('.wv2-circle-btn[aria-label="Back"]')).not.toBeNull();
  });

  it('a successful confirm clears the chip and shows the transient confirmation', async () => {
    const { controller, confirmEmailVerification } = makeController({ emailVerified: false });
    await controller.load();
    controller.showEmailVerify();

    await controller.confirmEmailVerificationCode('123456');

    expect(confirmEmailVerification).toHaveBeenCalledWith({ code: '123456' });
    expect(controller.unverified).toBe(false);
    expect(controller.state.kind).toBe('dashboard');
    // Reuses the dashboard's transient-notice surface.
    expect(controller.dashboardNotice).toBe(AvafliV2Strings.emailVerified);
    // …and the chip is gone on the next render.
    expect(chip(renderDashboard(controller, null, () => {}))).toBeNull();
  });

  it('a failed confirm stays on the verify screen with mapped error copy', async () => {
    const { controller, confirmEmailVerification } = makeController({ emailVerified: false });
    confirmEmailVerification.mockRejectedValueOnce(new Error('code expired'));
    await controller.load();
    controller.showEmailVerify();

    await controller.confirmEmailVerificationCode('000000');

    expect(controller.state.kind).toBe('emailVerify');
    expect(controller.unverified).toBe(true); // still unverified
    expect(controller.codeError).toBe(AvafliV2Strings.codeExpired);
  });

  it('a failed resend surfaces the resend error but keeps the screen up', async () => {
    const { controller, resendEmailVerification } = makeController({ emailVerified: false });
    resendEmailVerification.mockRejectedValueOnce(new Error('network'));
    await controller.load();
    controller.showEmailVerify();

    await controller.resendEmailVerificationCode();

    expect(controller.state.kind).toBe('emailVerify');
    expect(controller.codeError).toBe(AvafliV2Strings.codeResendFailed);
  });
});
