// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import { renderDashboard } from '../src/ui/v2/screens';
import { Giveaway, GetActiveGiveawayResponse, GiveawayWinner, SDKConfig } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * "WE HAVE A WINNER!" banner gating (Aug 31 GTM decision).
 *
 * The banner (and its + button — the winner-feed modal's ONLY entry point)
 * is server-flag-gated and DEFAULT HIDDEN: it renders only when
 * `sdkConfig.experience.winnerBannerEnabled` is exactly true AND the
 * giveaway carries a `latestWinner`. Absent/false/undefined flag → hidden,
 * even with a winner present.
 */

const WINNER: GiveawayWinner = {
  name: 'Catherine C.',
  location: 'Brooklyn, New York',
  awardedAt: '2026-08-30',
};

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
  latestWinner: WINNER,
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

function makeController(status: Partial<GetActiveGiveawayResponse>): V2ExperienceController {
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
  };
  return new V2ExperienceController(deps);
}

const experience = (winnerBannerEnabled?: boolean): SDKConfig => ({
  experience: winnerBannerEnabled === undefined ? {} : { winnerBannerEnabled },
});

const banner = (dash: HTMLElement): HTMLElement | null =>
  dash.querySelector<HTMLElement>('.wv2-winner-banner');

describe('winner banner flag gating (winnerBannerEnabled)', () => {
  it('hidden when the flag is absent, even with a latestWinner (default OFF)', async () => {
    const controller = makeController({ sdkConfig: experience(undefined) });
    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.giveaway?.latestWinner).toBeDefined();
    expect(banner(renderDashboard(controller, null, () => {}))).toBeNull();
  });

  it('hidden when sdkConfig itself is absent', async () => {
    const controller = makeController({});
    await controller.load();

    expect(banner(renderDashboard(controller, null, () => {}))).toBeNull();
  });

  it('hidden when the flag is false', async () => {
    const controller = makeController({ sdkConfig: experience(false) });
    await controller.load();

    expect(banner(renderDashboard(controller, null, () => {}))).toBeNull();
  });

  it('shown when the flag is true and a latestWinner exists', async () => {
    const controller = makeController({ sdkConfig: experience(true) });
    await controller.load();

    const dash = renderDashboard(controller, null, () => {});
    const el = banner(dash);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('WE HAVE A WINNER!');
    // The + button (winner-feed entry point) rides along with the banner.
    expect(dash.querySelector('.wv2-winner-banner-plus')).not.toBeNull();
  });

  it('flag true tap fires the winner-feed callback', async () => {
    const controller = makeController({ sdkConfig: experience(true) });
    await controller.load();

    const onWinnerTap = vi.fn();
    banner(renderDashboard(controller, null, onWinnerTap))!.dispatchEvent(new Event('click'));
    expect(onWinnerTap).toHaveBeenCalledTimes(1);
  });

  it('hidden when the flag is true but there is no latestWinner', async () => {
    const controller = makeController({
      giveaway: { ...GIVEAWAY, latestWinner: undefined },
      sdkConfig: experience(true),
    });
    await controller.load();

    expect(banner(renderDashboard(controller, null, () => {}))).toBeNull();
  });
});
