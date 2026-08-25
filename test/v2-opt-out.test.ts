// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import { AvafliV2Strings } from '../src/ui/v2/strings';
import { renderHowItWorks, renderOptOutDialog } from '../src/ui/v2/screens';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * The in-experience privacy opt-out. 2.9.5: raised by the privacy page's
 * delete bridge (the legal overlay) — the intermediate "Privacy choices"
 * card is gone, and the confirmation dialog mounts at ROOT level
 * (renderOptOutDialog) instead of inside the how-it-works screen:
 *
 *     idle → confirming → inFlight → done → (dismiss whole experience)
 *                     ↘ failed (inline error, retryable) ↗
 *
 * Failure NEVER pretends success — the confirmation stays up with the fixed
 * connection error and nothing is marked locally (the deps.optOut contract
 * rejects instead of swallowing, unlike the public Avafli.optOut()).
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
    api: {} as unknown as AvafliAPI,
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
    expect(controller.optOutError).toBe(AvafliV2Strings.optOutFailed);
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
    expect(controller.optOutError).toBe(AvafliV2Strings.optOutFailed);
    expect(dismissed).not.toHaveBeenCalled();
  });
});

describe('how-it-works screen: privacy surfaces removed (2.9.5)', () => {
  it('the "Privacy choices" fine-print link is gone — the legal-links row and capture inline links carry the privacy path', () => {
    const { controller } = makeController();
    const screen = renderHowItWorks(controller);
    expect(screen.querySelector('.wv2-privacy-link')).toBeNull();
    expect(screen.textContent).not.toContain('Privacy choices');
  });

  it('the how-it-works screen no longer mounts the opt-out dialog or the choices surface', () => {
    const { controller } = makeController();
    controller.showOptOutConfirmation();
    const screen = renderHowItWorks(controller);
    // The dialog mounts at ROOT level now (see renderOptOutDialog tests) —
    // and the intermediate privacy-choices listing is gone entirely.
    expect(screen.querySelector('.wv2-optout-card')).toBeNull();
    expect(screen.querySelector('.wv2-privacy-choice-link')).toBeNull();
    expect(screen.querySelector('.wv2-privacy-choice-delete')).toBeNull();
  });
});

describe('root-level opt-out confirmation UI (renderOptOutDialog)', () => {
  it('shows the destructive confirmation with the mandated copy while confirming', () => {
    const { controller } = makeController();
    controller.showOptOutConfirmation();
    const dialog = renderOptOutDialog(controller);
    expect(dialog.querySelector('.wv2-optout-title')?.textContent).toBe(
      AvafliV2Strings.optOutTitle
    );
    expect(dialog.querySelector('.wv2-optout-body')?.textContent).toBe(AvafliV2Strings.optOutBody);
    expect(dialog.querySelector('.wv2-pill-destructive')?.textContent).toBe(
      AvafliV2Strings.optOutConfirm
    );
    expect(dialog.querySelector('.wv2-optout-cancel')?.textContent).toBe(
      AvafliV2Strings.optOutCancel
    );
  });

  it('shows the brief "Your data has been deleted." state once done', () => {
    const { controller } = makeController();
    controller.optOutPhase = 'done';
    const dialog = renderOptOutDialog(controller);
    expect(dialog.querySelector('.wv2-optout-success')?.textContent).toBe(
      AvafliV2Strings.optOutSuccess
    );
    // The destructive controls are gone — nothing left to re-confirm.
    expect(dialog.querySelector('.wv2-pill-destructive')).toBeNull();
  });
});
