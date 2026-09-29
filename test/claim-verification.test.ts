// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { renderClaimCode, renderClaimSteps } from '../src/ui/v2/screens';
import { AvafliV2Strings } from '../src/ui/v2/strings';
import { PrizeClaimForm } from '../src/ui/v2/claim';
import {
  AvafliError,
  AvafliErrorCode,
  AvafliErrorDetails,
  ClaimVerificationBlock,
  GetActiveGiveawayResponse,
  Giveaway,
  PrizeClaimBlock,
} from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { NetworkClient } from '../src/network/client';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * 3.2.0 — six-digit email-ownership code before the prize-claim form.
 *
 * Pins:
 *  - no `verification` block / `required: false` → today's flow (form directly);
 *  - `required: true` → the code screen paints at once with the MASKED
 *    address while one idempotent send (no `resend`) runs behind it;
 *  - success → brief confirmation → form; mismatch / fresh code / cooldown /
 *    send failure / network failure each leave a next action on screen;
 *  - "Send a new code" is locked until `resendAvailableAt`;
 *  - the submit declares `supportsClaimVerification`, and a
 *    `claim_verification_required` answer detours through the code screen
 *    with the form input intact;
 *  - the SERVER holds the state: nothing is written locally, and a fresh
 *    controller resumes from the block alone.
 */

const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

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

const MASKED = 'a********e@avafli.example.com';

function pendingClaim(verification?: ClaimVerificationBlock): PrizeClaimBlock {
  return {
    status: 'pending',
    giveawayId: 'g1',
    prizeDescription: 'Cash Prize',
    prizeValue: 1000,
    maskedEmail: MASKED,
    ...(verification ? { verification } : {}),
  };
}

/** A block whose code went out `ageMs` before `now` (live for 10 minutes). */
function liveBlock(ageMs: number, now: number = NOW): ClaimVerificationBlock {
  const sent = now - ageMs;
  return {
    required: true,
    codeSentAt: iso(sent),
    codeExpiresAt: iso(sent + 10 * 60 * 1000),
    resendAvailableAt: iso(sent + 60 * 1000),
  };
}

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

/** A callable rejection as the network client surfaces it. */
function callableError(
  httpStatus: number,
  message: string,
  details?: AvafliErrorDetails
): AvafliError {
  const error = new AvafliError(
    httpStatus === 400 ? AvafliErrorCode.InvalidState : AvafliErrorCode.NetworkError,
    message
  );
  error.httpStatus = httpStatus;
  if (details) error.details = details;
  return error;
}

/** A request that never reached the server (no httpStatus). */
const transportError = (): AvafliError =>
  new AvafliError(AvafliErrorCode.NetworkError, 'Request failed after 2 attempts');

interface Harness {
  controller: V2ExperienceController;
  api: {
    getActiveGiveaway: ReturnType<typeof vi.fn>;
    claimDailyEntries: ReturnType<typeof vi.fn>;
    submitPrizeClaim: ReturnType<typeof vi.fn>;
    sendClaimVerificationCode: ReturnType<typeof vi.fn>;
    confirmClaimVerificationCode: ReturnType<typeof vi.fn>;
  };
  writes: string[];
  onPrizeClaimSubmitted: ReturnType<typeof vi.fn>;
}

function makeController(
  claim: PrizeClaimBlock,
  handlers: {
    send?: (data: { giveawayId: string; resend?: boolean }) => Promise<unknown>;
    confirm?: (data: { giveawayId: string; code: string }) => Promise<unknown>;
    submit?: () => Promise<unknown>;
  } = {}
): Harness {
  const giveawayResponse: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY,
    claimedToday: true,
    streakDay: 3,
    totalEntries: 100,
    emailConsentStatus: true,
    prizeClaim: claim,
  };
  const api = {
    getActiveGiveaway: vi.fn(async () => giveawayResponse),
    claimDailyEntries: vi.fn(async () => ({ entries: 60, streakDay: 4, totalEntries: 160 })),
    submitPrizeClaim: vi.fn(
      handlers.submit ??
        (async () => ({ claimNumber: 'WNR-2026-0042', submittedAt: '2026-09-29T12:00:00Z' }))
    ),
    sendClaimVerificationCode: vi.fn(
      handlers.send ?? (async () => ({ sent: true, verification: liveBlock(0) }))
    ),
    confirmClaimVerificationCode: vi.fn(
      handlers.confirm ?? (async () => ({ verified: true, verification: { required: false } }))
    ),
  };
  const store = new Map<string, string>([['winr_email_submitted_com.test', 'true']]);
  const writes: string[] = [];
  const onPrizeClaimSubmitted = vi.fn();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage,
    bundleId: 'com.test',
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => true,
    userPrefill: { firstName: 'Ada', lastName: 'Lovelace' },
    onPrizeClaimSubmitted,
  };
  return { controller: new V2ExperienceController(deps), api, writes, onPrizeClaimSubmitted };
}

/** Lets the promise chain behind a fire-and-forget call settle (no timers). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Opens the code screen and mounts it, as the experience root would. */
async function openCodeScreen(h: Harness, alreadyLoaded = false): Promise<HTMLElement> {
  if (!alreadyLoaded) await h.controller.load();
  let screen: HTMLElement | null = null;
  h.controller.onChange = (state) => {
    if (state.kind !== 'winnerClaim' || h.controller.winnerClaimStep.kind !== 'code') return;
    screen?.remove();
    screen = renderClaimCode(h.controller, state.claim);
    document.body.appendChild(screen);
  };
  h.controller.winnerClaimContinue();
  return screen!;
}

const field = (screen: HTMLElement): HTMLInputElement =>
  screen.querySelector('.wv2-code-input') as HTMLInputElement;
const statusText = (screen: HTMLElement): string =>
  (screen.querySelector('.wv2-code-status') as HTMLElement).textContent ?? '';
const statusShown = (screen: HTMLElement): boolean =>
  (screen.querySelector('.wv2-code-status') as HTMLElement).style.display !== 'none';
const notice = (screen: HTMLElement): HTMLElement =>
  screen.querySelector('.wv2-code-error') as HTMLElement;
const resendButton = (screen: HTMLElement): HTMLButtonElement =>
  screen.querySelector('.wv2-code-resend') as HTMLButtonElement;

function type(screen: HTMLElement, digits: string): void {
  const input = field(screen);
  input.value = digits;
  input.dispatchEvent(new Event('input'));
}

describe('3.2.0 claim email-ownership step', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Backwards compatibility ──

  it('no verification block → the claim button opens the form, exactly as before', async () => {
    const h = makeController(pendingClaim());
    await h.controller.load();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'splash' });

    h.controller.winnerClaimContinue();
    await settle();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });
    expect(h.api.sendClaimVerificationCode).not.toHaveBeenCalled();
  });

  it('required: false → the form directly, no code is sent', async () => {
    const h = makeController(pendingClaim({ required: false }));
    await h.controller.load();
    h.controller.winnerClaimContinue();
    await settle();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });
    expect(h.api.sendClaimVerificationCode).not.toHaveBeenCalled();
  });

  // ── The code screen ──

  it('required: true → the first frame shows the masked email while ONE send (no resend) runs', async () => {
    let release!: (value: unknown) => void;
    const h = makeController(pendingClaim({ required: true }), {
      send: () => new Promise((resolve) => (release = resolve)),
    });
    const screen = await openCodeScreen(h);

    // Painted before the send answered: title, masked address, field,
    // resend action, help line — and the small "sending" status.
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
    expect(screen.querySelector('.wv2-capture-title')?.textContent).toBe(
      AvafliV2Strings.claimCodeTitle
    );
    expect(screen.querySelector('.wv2-code-sub')?.textContent).toBe(
      `Enter the 6-digit code we sent to ${MASKED}`
    );
    expect(statusText(screen)).toBe(AvafliV2Strings.claimCodeSending);
    expect(field(screen).disabled).toBe(false);
    expect(field(screen).getAttribute('autocomplete')).toBe('one-time-code');
    expect(field(screen).getAttribute('inputmode')).toBe('numeric');
    expect(resendButton(screen).textContent).toContain('Send a new code');
    const help = screen.querySelector('.wv2-code-help') as HTMLElement;
    expect(help.textContent).toBe("Can't get to this email? Contact info@avafli.com");
    expect(help.querySelector('a')?.getAttribute('href')).toBe('mailto:info@avafli.com');

    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledWith({ giveawayId: 'g1' });

    release({ sent: true, verification: liveBlock(0) });
    await settle();
    expect(statusText(screen)).toBe(AvafliV2Strings.claimCodeSent);
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
  });

  it('never says "OTP", "2FA" or "token" on screen', async () => {
    const h = makeController(pendingClaim({ required: true }));
    const screen = await openCodeScreen(h);
    await settle();
    expect(screen.textContent ?? '').not.toMatch(/otp|2fa|token/i);
  });

  it('a live code in the block → still one idempotent send, and no "Code sent" when sent: false', async () => {
    const block = liveBlock(20_000);
    const h = makeController(pendingClaim(block), {
      send: async () => ({ sent: false, verification: block }),
    });
    const screen = await openCodeScreen(h);
    await settle();

    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledWith({ giveawayId: 'g1' });
    expect(statusShown(screen)).toBe(false);
    expect(screen.textContent).not.toContain(AvafliV2Strings.claimCodeSent);
    // The countdown runs from the block: 60 s cooldown, 20 s already gone.
    expect(h.controller.claimCodeResendSecondsLeft()).toBe(40);
  });

  it('a correct code → brief confirmation → the claim form; the session never re-asks', async () => {
    const h = makeController(pendingClaim({ required: true }));
    const screen = await openCodeScreen(h);
    await settle();

    type(screen, '123456'); // auto-submit on the sixth digit
    await settle();
    expect(h.api.confirmClaimVerificationCode).toHaveBeenCalledWith({
      giveawayId: 'g1',
      code: '123456',
    });
    expect(h.controller.claimCodeVerified).toBe(true);
    expect(statusText(screen)).toBe(AvafliV2Strings.emailVerified);
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });

    vi.advanceTimersByTime(V2ExperienceController.CLAIM_CODE_VERIFIED_HOLD_MS);
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });

    // In-memory block now says the inbox is proven.
    expect(h.controller.state.kind).toBe('winnerClaim');
    if (h.controller.state.kind === 'winnerClaim') {
      expect(h.controller.state.claim.verification).toEqual({ required: false });
    }
    h.controller.winnerClaimStep = { kind: 'splash' };
    h.controller.winnerClaimContinue();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
  });

  it('five digits do not submit; a pasted "123 456" does', async () => {
    const h = makeController(pendingClaim({ required: true }));
    const screen = await openCodeScreen(h);
    await settle();

    type(screen, '12345');
    await settle();
    expect(h.api.confirmClaimVerificationCode).not.toHaveBeenCalled();

    const paste = new Event('paste', { cancelable: true }) as Event & {
      clipboardData?: { getData: (kind: string) => string };
    };
    paste.clipboardData = { getData: () => '123 456' };
    field(screen).dispatchEvent(paste);
    await settle();
    expect(h.api.confirmClaimVerificationCode).toHaveBeenCalledWith({
      giveawayId: 'g1',
      code: '123456',
    });
  });

  it('a wrong code → inline error with the tries left; the field is cleared', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      confirm: async () => {
        throw callableError(403, "That code didn't match. Check the email and try again.", {
          reason: 'code_mismatch',
          attemptsRemaining: 3,
        });
      },
    });
    const screen = await openCodeScreen(h);
    await settle();

    type(screen, '111111');
    await settle();
    expect(notice(screen).textContent).toBe("That code didn't match. 3 tries left.");
    expect(notice(screen).classList.contains('wv2-code-info')).toBe(false);
    expect(field(screen).value).toBe('');
    expect(h.controller.claimCodeDraft).toBe('');
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
    // Still usable: the pill is back, the field accepts another code.
    expect((screen.querySelector('.wv2-pill') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the last try reads "1 try left"', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      confirm: async () => {
        throw callableError(403, 'nope', { reason: 'code_mismatch', attemptsRemaining: 1 });
      },
    });
    const screen = await openCodeScreen(h);
    await settle();
    type(screen, '111111');
    await settle();
    expect(notice(screen).textContent).toBe("That code didn't match. 1 try left.");
  });

  it('fresh_code_sent → information (not an error) with the server message; countdown restarts', async () => {
    const SERVER_MESSAGE = 'That code expired, so we sent you a new one. Check your email.';
    const h = makeController(pendingClaim(liveBlock(9 * 60 * 1000)), {
      send: async () => ({ sent: false, verification: liveBlock(9 * 60 * 1000) }),
      confirm: async () => {
        throw callableError(400, SERVER_MESSAGE, {
          reason: 'fresh_code_sent',
          verification: liveBlock(0),
        });
      },
    });
    const screen = await openCodeScreen(h);
    await settle();
    expect(h.controller.claimCodeResendSecondsLeft()).toBe(0);
    expect(resendButton(screen).disabled).toBe(false);

    type(screen, '111111');
    await settle();
    expect(notice(screen).textContent).toBe(SERVER_MESSAGE);
    expect(notice(screen).classList.contains('wv2-code-info')).toBe(true);
    expect(field(screen).value).toBe('');
    // The new code's block was adopted: a fresh 60 s before the next resend.
    expect(h.controller.claimCodeResendSecondsLeft()).toBe(60);
    expect(resendButton(screen).disabled).toBe(true);
    if (h.controller.state.kind === 'winnerClaim') {
      expect(h.controller.state.claim.verification).toEqual(liveBlock(0));
    }
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
  });

  it('"Send a new code" is locked, counting down, until resendAvailableAt — then sends with resend: true', async () => {
    const block = liveBlock(15_000);
    const h = makeController(pendingClaim(block), {
      send: async (data) =>
        data.resend
          ? { sent: true, verification: liveBlock(0, Date.now()) }
          : { sent: false, verification: block },
    });
    const screen = await openCodeScreen(h);
    await settle();

    const resend = resendButton(screen);
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toContain('Send a new code in 0:45');

    // Tapping early does nothing.
    await h.controller.resendClaimCode();
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(10_000);
    expect(resend.textContent).toContain('Send a new code in 0:35');
    expect(resend.disabled).toBe(true);

    vi.advanceTimersByTime(35_000);
    expect(resend.disabled).toBe(false);
    expect(resend.textContent).toContain('Send a new code');
    expect(resend.textContent).not.toContain(' in ');

    resend.click();
    await settle();
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledTimes(2);
    expect(h.api.sendClaimVerificationCode).toHaveBeenLastCalledWith({
      giveawayId: 'g1',
      resend: true,
    });
    expect(statusText(screen)).toBe(AvafliV2Strings.claimCodeSent);
    // …and the new code starts its own cooldown.
    expect(resend.disabled).toBe(true);
    expect(h.controller.claimCodeResendSecondsLeft()).toBe(60);
  });

  it("a device clock that is behind never locks the resend for longer than the server's 60 s", async () => {
    const ahead: ClaimVerificationBlock = {
      required: true,
      codeSentAt: iso(NOW + 5 * 60 * 1000),
      codeExpiresAt: iso(NOW + 15 * 60 * 1000),
      resendAvailableAt: iso(NOW + 6 * 60 * 1000),
    };
    const h = makeController(pendingClaim(ahead), {
      send: async () => ({ sent: false, verification: ahead }),
    });
    await openCodeScreen(h);
    await settle();
    expect(h.controller.claimCodeResendSecondsLeft()).toBe(60);
  });

  it('resend_cooldown / send_limit → inline message; the countdown follows retryAfterSeconds', async () => {
    const block = liveBlock(2 * 60 * 1000);
    let reason = 'resend_cooldown';
    let retryAfterSeconds = 25;
    const h = makeController(pendingClaim(block), {
      send: async (data) => {
        if (!data.resend) return { sent: false, verification: block };
        throw callableError(429, 'Please wait 25 seconds before requesting another code.', {
          reason,
          retryAfterSeconds,
        });
      },
    });
    const screen = await openCodeScreen(h);
    await settle();

    resendButton(screen).click();
    await settle();
    expect(notice(screen).textContent).toBe(AvafliV2Strings.claimCodeCooldown);
    expect(h.controller.claimCodeResendSecondsLeft()).toBe(25);
    expect(resendButton(screen).disabled).toBe(true);
    expect(resendButton(screen).textContent).toContain('0:25');

    vi.advanceTimersByTime(25_000);
    expect(resendButton(screen).disabled).toBe(false);

    reason = 'send_limit';
    retryAfterSeconds = 1800;
    resendButton(screen).click();
    await settle();
    expect(notice(screen).textContent).toBe(AvafliV2Strings.claimCodeSendLimit);
    expect(resendButton(screen).textContent).toContain('30:00');
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
  });

  it('a failed send is inline and retryable, and the field stays usable', async () => {
    let attempt = 0;
    const h = makeController(pendingClaim({ required: true }), {
      send: async () => {
        attempt++;
        if (attempt === 1) {
          throw callableError(503, "We couldn't send your code just now.", {
            reason: 'send_failed',
          });
        }
        return { sent: true, verification: liveBlock(0) };
      },
    });
    const screen = await openCodeScreen(h);
    await settle();

    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
    expect(statusText(screen)).toContain(AvafliV2Strings.claimCodeSendFailed);
    const retry = screen.querySelector('.wv2-code-retry') as HTMLButtonElement;
    expect(retry.textContent).toBe(AvafliV2Strings.claimCodeRetry);

    // A code from an earlier send may still be in their inbox: typing works.
    expect(field(screen).disabled).toBe(false);
    type(screen, '12');
    expect(field(screen).value).toBe('12');

    retry.click();
    await settle();
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledTimes(2);
    expect(h.api.sendClaimVerificationCode).toHaveBeenLastCalledWith({ giveawayId: 'g1' });
    expect(statusText(screen)).toBe(AvafliV2Strings.claimCodeSent);
    expect(screen.querySelector('.wv2-code-retry')).toBeNull();
    // The in-place update left what they had typed alone.
    expect(field(screen).value).toBe('12');
  });

  it('a send that never reached the server says so, with Retry', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      send: async () => {
        throw transportError();
      },
    });
    const screen = await openCodeScreen(h);
    await settle();
    expect(statusText(screen)).toContain(AvafliV2Strings.claimCodeNetwork);
    expect(screen.querySelector('.wv2-code-retry')).not.toBeNull();
  });

  it('no email on file → the contact address, and no Retry that cannot work', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      send: async () => {
        throw callableError(400, "We don't have an email on file for this account.", {
          reason: 'no_email_on_file',
        });
      },
    });
    const screen = await openCodeScreen(h);
    await settle();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
    expect(statusText(screen)).toContain(AvafliV2Strings.claimCodeNoEmail);
    expect(screen.querySelector('.wv2-code-retry')).toBeNull();
    expect(screen.querySelector('.wv2-code-help a')).not.toBeNull();
  });

  it('a network failure on the check keeps what they typed', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      confirm: async () => {
        throw transportError();
      },
    });
    const screen = await openCodeScreen(h);
    await settle();

    type(screen, '654321');
    await settle();
    expect(notice(screen).textContent).toBe(
      "We couldn't reach the server. Check your connection and try again."
    );
    expect(field(screen).value).toBe('654321');
    expect(h.controller.claimCodeDraft).toBe('654321');
    expect((screen.querySelector('.wv2-pill') as HTMLButtonElement).disabled).toBe(false);
  });

  it('claim expired / no longer available → leaves the code screen for the normal experience', async () => {
    const MESSAGE = 'The claim window for this prize has expired';
    const h = makeController(pendingClaim({ required: true }), {
      confirm: async () => {
        throw callableError(400, MESSAGE);
      },
    });
    const screen = await openCodeScreen(h);
    await settle();

    type(screen, '123456');
    await settle();
    expect(h.controller.state.kind).toBe('dashboard');
    expect(h.controller.dashboardNotice).toBe(MESSAGE);
  });

  it('"Not the winner" on the send leaves the claim flow too', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      send: async () => {
        throw callableError(403, 'Not the winner');
      },
    });
    await openCodeScreen(h);
    await settle();
    expect(h.controller.state.kind).toBe('dashboard');
    expect(h.controller.dashboardNotice).toBe(AvafliV2Strings.claimUnavailable);
  });

  it('Back returns to the splash and sends or invalidates nothing', async () => {
    const block = liveBlock(20_000);
    const h = makeController(pendingClaim(block), {
      send: async () => ({ sent: false, verification: block }),
    });
    const screen = await openCodeScreen(h);
    await settle();

    (screen.querySelector('button[aria-label="Back"]') as HTMLButtonElement).click();
    await settle();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'splash' });
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
    expect(h.api.confirmClaimVerificationCode).not.toHaveBeenCalled();
  });

  it('the server answering "already proven" on the send goes on to the form', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      send: async () => ({ sent: false, verification: { required: false } }),
    });
    await openCodeScreen(h);
    await settle();
    vi.advanceTimersByTime(V2ExperienceController.CLAIM_CODE_VERIFIED_HOLD_MS);
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });
    expect(h.api.confirmClaimVerificationCode).not.toHaveBeenCalled();
  });

  // ── Server-held state ──

  it('writes NOTHING to local storage during the whole step', async () => {
    const h = makeController(pendingClaim({ required: true }), {
      confirm: vi
        .fn()
        .mockRejectedValueOnce(
          callableError(403, 'nope', { reason: 'code_mismatch', attemptsRemaining: 4 })
        )
        .mockResolvedValueOnce({ verified: true, verification: { required: false } }),
    });
    await h.controller.load();
    const before = h.writes.length;

    const screen = await openCodeScreen(h, true);
    await settle();
    type(screen, '111111');
    await settle();
    type(screen, '222222');
    await settle();
    vi.advanceTimersByTime(V2ExperienceController.CLAIM_CODE_VERIFIED_HOLD_MS);
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });

    expect(h.writes.slice(before)).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('reopen after close resumes from the server block: a live code → the code screen', async () => {
    // First open: the code goes out, the drawer is closed.
    const first = makeController(pendingClaim({ required: true }));
    await openCodeScreen(first);
    await settle();

    // Next open: a FRESH controller, the block now carries the live code.
    vi.setSystemTime(NOW + 30_000);
    const block = liveBlock(0); // sent at NOW, i.e. 30 s ago
    const next = makeController(pendingClaim(block), {
      send: async () => ({ sent: false, verification: block }),
    });
    await next.controller.load();
    expect(next.controller.winnerClaimStep).toEqual({ kind: 'splash' });

    const screen = await openCodeScreen(next, true);
    await settle();
    expect(next.controller.winnerClaimStep).toEqual({ kind: 'code' });
    expect(next.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
    expect(next.api.sendClaimVerificationCode).toHaveBeenCalledWith({ giveawayId: 'g1' });
    expect(statusShown(screen)).toBe(false); // nothing new was mailed
    expect(next.controller.claimCodeResendSecondsLeft()).toBe(30);
  });

  it('reopen after close resumes from the server block: already verified → the form', async () => {
    const next = makeController(pendingClaim({ required: false }));
    await next.controller.load();
    expect(next.controller.winnerClaimStep).toEqual({ kind: 'splash' });
    next.controller.winnerClaimContinue();
    expect(next.controller.winnerClaimStep).toEqual({ kind: 'form' });
    expect(next.api.sendClaimVerificationCode).not.toHaveBeenCalled();
  });

  // ── Claim form submit ──

  it('claim_verification_required on submit → the code screen, then back to the form with every field intact', async () => {
    let verified = false;
    const h = makeController(pendingClaim(), {
      submit: async () => {
        if (!verified) {
          throw callableError(400, 'Verify your email to claim your prize.', {
            reason: 'claim_verification_required',
          });
        }
        return { claimNumber: 'WNR-2026-0042', submittedAt: '2026-09-29T12:00:00Z' };
      },
      confirm: async () => {
        verified = true;
        return { verified: true, verification: { required: false } };
      },
    });
    await h.controller.load();
    h.controller.winnerClaimContinue();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });

    const typed: PrizeClaimForm = { ...VALID_FORM, apt: 'Unit 4', photoBase64: 'QUJD' };
    await h.controller.submitPrizeClaim(typed);
    await settle();

    // Routed to the code screen; the form is held in memory, untouched.
    expect(h.onPrizeClaimSubmitted).not.toHaveBeenCalled();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
    expect(h.controller.claimSubmitError).toBeNull();
    expect(h.controller.claimFormDraft).toBe(typed);
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledWith({ giveawayId: 'g1' });

    await h.controller.confirmClaimCode('123456');
    vi.advanceTimersByTime(V2ExperienceController.CLAIM_CODE_VERIFIED_HOLD_MS);
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });
    expect(h.controller.claimFormDraft).toEqual({
      ...VALID_FORM,
      apt: 'Unit 4',
      photoBase64: 'QUJD',
    });

    // The form comes back on its review screen, carrying what was typed.
    if (h.controller.state.kind !== 'winnerClaim') throw new Error('expected the winner flow');
    const form = renderClaimSteps(h.controller, h.controller.state.claim);
    expect(form.querySelector('.wv2-step-title')?.textContent).toBe('ALMOST DONE!');
    expect(
      form.querySelector('.wv2-consent-row')?.getAttribute('aria-pressed')
    ).toBe('true');

    await h.controller.submitPrizeClaim(h.controller.claimFormDraft!);
    expect(h.api.submitPrizeClaim).toHaveBeenLastCalledWith(
      expect.objectContaining({ street: '12 Analytical Way', apt: 'Unit 4', photoBase64: 'QUJD' })
    );
    expect(h.controller.winnerClaimStep.kind).toBe('share');
    expect(h.controller.claimFormDraft).toBeNull();
    // The SDK is told at once: the claim is no longer pending.
    expect(h.onPrizeClaimSubmitted).toHaveBeenCalledOnce();
  });
});

describe('3.2.0 claim email-ownership step — inside the experience', () => {
  it('CONTINUE on the splash mounts the code screen in the drawer; closing leaves nothing behind', async () => {
    document.body.replaceChildren();
    const block: ClaimVerificationBlock = { required: true };
    const h = makeController(pendingClaim(block), {
      send: async () => ({ sent: true, verification: liveBlock(0, Date.now()) }),
    });
    const { AvafliV2Experience } = await import('../src/ui/v2/root');
    const experience = new AvafliV2Experience(h.controller);
    void experience.present();
    const shadow = (): ShadowRoot =>
      (document.querySelector('[data-winr="v2"]') as HTMLElement).shadowRoot!;

    await vi.waitFor(() => expect(shadow().querySelector('.wv2-claim-congrats')).not.toBeNull());
    const before = h.writes.length;
    (shadow().querySelector('.wv2-claim-cta .wv2-pill') as HTMLButtonElement).click();

    // Painted at once — the send has not answered yet.
    expect(shadow().querySelector('.wv2-code-sub')?.textContent).toContain(MASKED);
    expect(shadow().querySelector('.wv2-code-input')).not.toBeNull();
    await vi.waitFor(() =>
      expect(shadow().querySelector('.wv2-code-status')?.textContent).toBe(
        AvafliV2Strings.claimCodeSent
      )
    );
    expect(shadow().querySelector('.wv2-code-resend-action')?.textContent).toMatch(
      /^Send a new code in \d:\d\d$/
    );

    // Close mid-step: no local state to clean up, because none was written.
    experience.dismiss();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(document.querySelector('[data-winr="v2"]')).toBeNull();
    expect(h.writes.slice(before)).toEqual([]);
    expect(h.api.sendClaimVerificationCode).toHaveBeenCalledOnce();
    expect(h.api.confirmClaimVerificationCode).not.toHaveBeenCalled();
  });
});

describe('3.2.0 claim verification — API + network layer', () => {
  const okResponse = (result: unknown): Response =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ result }),
      text: async () => JSON.stringify({ result }),
    }) as unknown as Response;

  const errorResponse = (status: number, error: unknown): Response =>
    ({
      ok: false,
      status,
      headers: { get: () => 'application/json' },
      json: async () => ({ error }),
      text: async () => JSON.stringify({ error }),
    }) as unknown as Response;

  function apiOver(fetchMock: ReturnType<typeof vi.fn>): AvafliAPI {
    (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;
    return new AvafliAPI(new NetworkClient({ baseURL: 'https://api.test', apiKey: 'k' }));
  }

  const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> =>
    (JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body)) as {
      data: Record<string, unknown>;
    }).data;

  it('submitPrizeClaim sends supportsClaimVerification: true', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ claimNumber: 'WNR-1', submittedAt: '2026-09-29T12:00:00Z' })
    );
    const api = apiOver(fetchMock);
    await api.submitPrizeClaim({
      giveawayId: 'g1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      street: '12 Analytical Way',
      city: 'Brooklyn',
      state: 'New York',
      zip: '11201',
      country: 'United States',
      promoConsentGranted: false,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.test/submitPrizeClaim');
    expect(sentBody(fetchMock)).toMatchObject({
      giveawayId: 'g1',
      supportsClaimVerification: true,
    });
  });

  it('send / confirm post the contract payloads to their callables', async () => {
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes('/send')
        ? okResponse({ sent: true, verification: { required: true } })
        : okResponse({ verified: true, verification: { required: false } })
    );
    const api = apiOver(fetchMock);

    await api.sendClaimVerificationCode({ giveawayId: 'g1' });
    await api.sendClaimVerificationCode({ giveawayId: 'g1', resend: true });
    const confirmed = await api.confirmClaimVerificationCode({ giveawayId: 'g1', code: '123456' });

    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.test/sendClaimVerificationCode');
    expect(sentBody(fetchMock, 0)).toEqual({ giveawayId: 'g1' });
    expect(sentBody(fetchMock, 1)).toEqual({ giveawayId: 'g1', resend: true });
    expect(String(fetchMock.mock.calls[2]![0])).toBe(
      'https://api.test/confirmClaimVerificationCode'
    );
    expect(sentBody(fetchMock, 2)).toEqual({ giveawayId: 'g1', code: '123456' });
    expect(confirmed).toEqual({ verified: true, verification: { required: false } });
  });

  it("a callable error's details (reason + fields) reach the caller", async () => {
    const fetchMock = vi.fn(async () =>
      errorResponse(403, {
        status: 'PERMISSION_DENIED',
        message: "That code didn't match. Check the email and try again.",
        details: { reason: 'code_mismatch', attemptsRemaining: 2 },
      })
    );
    const api = apiOver(fetchMock);
    const error = (await api
      .confirmClaimVerificationCode({ giveawayId: 'g1', code: '000000' })
      .catch((e: unknown) => e)) as AvafliError;

    expect(error).toBeInstanceOf(AvafliError);
    expect(error.message).toBe("That code didn't match. Check the email and try again.");
    expect(error.httpStatus).toBe(403);
    expect(error.details).toEqual({ reason: 'code_mismatch', attemptsRemaining: 2 });
    expect(fetchMock).toHaveBeenCalledOnce(); // a definitive answer is never retried
  });

  it('an error without details is exactly what it was before', async () => {
    const fetchMock = vi.fn(async () =>
      errorResponse(403, { status: 'PERMISSION_DENIED', message: 'Not the winner' })
    );
    const api = apiOver(fetchMock);
    const error = (await api
      .sendClaimVerificationCode({ giveawayId: 'g1' })
      .catch((e: unknown) => e)) as AvafliError;
    expect(error.message).toBe('Not the winner');
    expect(error.httpStatus).toBe(403);
    expect(error.details).toBeUndefined();
  });
});
