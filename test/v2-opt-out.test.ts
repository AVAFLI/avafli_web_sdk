// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import { WINRV2Strings } from '../src/ui/v2/strings';
import { renderHowItWorks } from '../src/ui/v2/screens';
import { WINRAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * The 2.6.1 in-experience privacy opt-out ("Privacy choices" on the
 * how-it-works screen):
 *
 *     idle → confirming → inFlight → done → (dismiss whole experience)
 *                     ↘ failed (inline error, retryable) ↗
 *
 * Failure NEVER pretends success — the confirmation stays up with the fixed
 * connection error and nothing is marked locally (the deps.optOut contract
 * rejects instead of swallowing, unlike the public WINR.optOut()).
 */

function fakeStorage(): LocalStorageProvider {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function makeController(optOut?: () => Promise<void>): {
  controller: V2ExperienceController;
  dismissed: ReturnType<typeof vi.fn>;
} {
  const deps: V2ControllerDeps = {
    api: {} as unknown as WINRAPI,
    storage: fakeStorage(),
    bundleId: 'com.test',
    submitEmailAndAdopt: vi.fn(),
    hasRegisteredUuid: () => true,
    ...(optOut ? { optOut } : {}),
  };
  const controller = new V2ExperienceController(deps);
  const dismissed = vi.fn();
  controller.onDismissRequest = dismissed;
  return { controller, dismissed };
}

describe('Privacy choices → delete-my-data flow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('raises the confirmation from idle only', () => {
    const { controller } = makeController();
    expect(controller.optOutPhase).toBe('idle');
    controller.showOptOutConfirmation();
    expect(controller.optOutPhase).toBe('confirming');
    controller.showOptOutConfirmation();
    expect(controller.optOutPhase).toBe('confirming');
  });

  it('cancel returns to idle from confirming', () => {
    const { controller } = makeController();
    controller.showOptOutConfirmation();
    controller.cancelOptOut();
    expect(controller.optOutPhase).toBe('idle');
  });

  it('confirm from idle is a no-op', async () => {
    const optOut = vi.fn(async () => {});
    const { controller } = makeController(optOut);
    await controller.confirmOptOut();
    expect(controller.optOutPhase).toBe('idle');
    expect(optOut).not.toHaveBeenCalled();
  });

  it('success shows the deleted state, then dismisses the whole experience', async () => {
    const optOut = vi.fn(async () => {});
    const { controller, dismissed } = makeController(optOut);
    controller.showOptOutConfirmation();
    const pending = controller.confirmOptOut();
    expect(controller.optOutPhase).toBe('inFlight');
    await pending;

    expect(controller.optOutPhase).toBe('done');
    expect(optOut).toHaveBeenCalledTimes(1);
    // The success copy holds for the dismiss delay, THEN the experience closes.
    expect(dismissed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(V2ExperienceController.OPT_OUT_SUCCESS_HOLD_MS);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('failure shows the fixed connection error and stays retryable — never a pretended success', async () => {
    const optOut = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    const { controller, dismissed } = makeController(optOut);
    controller.showOptOutConfirmation();
    await controller.confirmOptOut();

    expect(controller.optOutPhase).toBe('failed');
    expect(controller.optOutError).toBe(WINRV2Strings.optOutFailed);
    expect(dismissed).not.toHaveBeenCalled();

    // The destructive button remains live: confirm retries from 'failed'.
    await controller.confirmOptOut();
    expect(controller.optOutPhase).toBe('done');
  });

  it('a missing optOut dependency fails honestly instead of pretending success', async () => {
    const { controller, dismissed } = makeController();
    controller.showOptOutConfirmation();
    await controller.confirmOptOut();
    expect(controller.optOutPhase).toBe('failed');
    expect(controller.optOutError).toBe(WINRV2Strings.optOutFailed);
    expect(dismissed).not.toHaveBeenCalled();
  });
});

describe('how-it-works screen: privacy entry point + confirmation UI', () => {
  it('renders the muted "Privacy choices" link at the bottom', () => {
    const { controller } = makeController();
    const screen = renderHowItWorks(controller);
    const link = screen.querySelector('.wv2-privacy-link');
    expect(link?.textContent).toBe(WINRV2Strings.privacyChoices);
    expect(screen.querySelector('.wv2-optout-card')).toBeNull();
  });

  it('shows the destructive confirmation with the mandated copy while confirming', () => {
    const { controller } = makeController();
    controller.showOptOutConfirmation();
    const screen = renderHowItWorks(controller);
    expect(screen.querySelector('.wv2-optout-title')?.textContent).toBe(
      WINRV2Strings.optOutTitle
    );
    expect(screen.querySelector('.wv2-optout-body')?.textContent).toBe(WINRV2Strings.optOutBody);
    expect(screen.querySelector('.wv2-pill-destructive')?.textContent).toBe(
      WINRV2Strings.optOutConfirm
    );
    expect(screen.querySelector('.wv2-optout-cancel')?.textContent).toBe(
      WINRV2Strings.optOutCancel
    );
  });

  it('shows the brief "Your data has been deleted." state once done', () => {
    const { controller } = makeController();
    controller.optOutPhase = 'done';
    const screen = renderHowItWorks(controller);
    expect(screen.querySelector('.wv2-optout-success')?.textContent).toBe(
      WINRV2Strings.optOutSuccess
    );
    // The destructive controls are gone — nothing left to re-confirm.
    expect(screen.querySelector('.wv2-pill-destructive')).toBeNull();
  });
});
