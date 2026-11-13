// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import {
  appendSponsorDisclosure,
  renderCapture,
  renderDashboard,
  renderWinnerSplash,
  sponsorDisclosureSource,
} from '../src/ui/v2/screens';
import { AVAFLI_CONSTANTS, Giveaway, GetActiveGiveawayResponse, PrizeClaimBlock } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * 3.3.0 — shared giveaway sponsor disclosure.
 *
 * A shared giveaway (one shared prize pool across many publisher apps, with
 * Avafli LLC as Sponsor of Record) arrives with `scope: "network"` and a
 * `sponsorDisclosure` string. Legally the disclosure must appear wherever the
 * prize is presented. An exclusive giveaway carries neither field and must
 * render EXACTLY as before — no element, no layout change.
 */

const EXCLUSIVE: Giveaway = {
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

const DISCLOSURE = 'Sponsored by Avafli LLC';

const NETWORK: Giveaway = {
  ...EXCLUSIVE,
  id: 'net1',
  scope: 'network',
  sponsorDisclosure: DISCLOSURE,
};

function fakeStorage(consented: boolean): LocalStorageProvider {
  const store = new Map<string, string>();
  if (consented) store.set('winr_email_submitted_com.test', 'true');
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function makeController(
  giveaway: Giveaway | null,
  consented: boolean,
  status: Partial<GetActiveGiveawayResponse> = {}
): V2ExperienceController {
  const api = {
    getActiveGiveaway: vi.fn(async () => ({
      giveaway,
      claimedToday: true,
      streakDay: 3,
      totalEntries: 100,
      emailConsentStatus: consented,
      ...status,
    })),
    claimDailyEntries: vi.fn(async () => ({ entries: 10, streakDay: 3, totalEntries: 110 })),
  };
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage: fakeStorage(consented),
    bundleId: 'com.test',
    submitEmailAndAdopt: vi.fn(async () => ({ success: true })),
    hasRegisteredUuid: () => true,
  };
  return new V2ExperienceController(deps);
}

const sponsorLines = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.wv2-sponsor'));

describe('Giveaway type: scope + sponsorDisclosure parse through untouched', () => {
  it('both fields are undefined on an exclusive giveaway payload', () => {
    // The SDK stores the server's giveaway object as-is (JSON passthrough),
    // so a round-trip through JSON must keep the fields exactly as sent.
    const parsed = JSON.parse(JSON.stringify(EXCLUSIVE)) as Giveaway;
    expect(parsed.scope).toBeUndefined();
    expect(parsed.sponsorDisclosure).toBeUndefined();
    expect('sponsorDisclosure' in parsed).toBe(false);
  });

  it('both fields survive on a shared giveaway payload', () => {
    const parsed = JSON.parse(JSON.stringify(NETWORK)) as Giveaway;
    expect(parsed.scope).toBe('network');
    expect(parsed.sponsorDisclosure).toBe(DISCLOSURE);
  });

  it('SDK_VERSION is 3.3.1', () => {
    expect(AVAFLI_CONSTANTS.SDK_VERSION).toBe('3.3.1');
  });
});

describe('appendSponsorDisclosure', () => {
  it('appends nothing when the field is absent, empty or whitespace', () => {
    for (const g of [null, undefined, EXCLUSIVE, { sponsorDisclosure: '' }, { sponsorDisclosure: '   ' }]) {
      const parent = document.createElement('div');
      expect(appendSponsorDisclosure(parent, g, 'wv2-sponsor-strip')).toBeNull();
      expect(parent.childNodes.length).toBe(0);
    }
  });

  it('renders the server string as text, never as markup', () => {
    const parent = document.createElement('div');
    const hostile = 'Sponsored by <img src=x onerror="alert(1)"> & co';
    const line = appendSponsorDisclosure(parent, { sponsorDisclosure: hostile }, 'wv2-sponsor-card');
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe(hostile);
    expect(line!.querySelector('img')).toBeNull();
    expect(line!.children.length).toBe(0);
    expect(line!.className).toBe('wv2-sponsor wv2-sponsor-card');
  });
});

describe('Day-1 capture strip (renderCapture)', () => {
  it('exclusive giveaway: no sponsor element, strip markup unchanged', async () => {
    const c = makeController(EXCLUSIVE, false);
    await c.load();
    expect(c.state.kind).toBe('emailCapture');
    const screen = renderCapture(c, null);
    expect(sponsorLines(screen)).toHaveLength(0);
    const strip = screen.querySelector<HTMLElement>('.wv2-prize-strip')!;
    expect(strip.children.length).toBe(1); // just the cash headline
  });

  it('shared giveaway: one muted line directly under the prize headline', async () => {
    const c = makeController(NETWORK, false);
    await c.load();
    const screen = renderCapture(c, null);
    const lines = sponsorLines(screen);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(DISCLOSURE);
    const strip = screen.querySelector<HTMLElement>('.wv2-prize-strip')!;
    expect(strip.lastElementChild).toBe(lines[0]);
    expect(lines[0].previousElementSibling?.className).toBe('wv2-prize-strip-cash');
    expect(lines[0].classList.contains('wv2-sponsor-strip')).toBe(true);
  });
});

describe('Day-2+ prize card (renderDashboard)', () => {
  it('exclusive giveaway: no sponsor element in the headline lockup', async () => {
    const c = makeController(EXCLUSIVE, true);
    await c.load();
    expect(c.state.kind).toBe('dashboard');
    const dash = renderDashboard(c, null, () => {});
    expect(sponsorLines(dash)).toHaveLength(0);
    expect(dash.querySelector('.wv2-ph-cash')!.children.length).toBe(2); // WIN $X + CASH PRIZE
  });

  it('shared giveaway (cash): sponsor line is the last child of the cash lockup', async () => {
    const c = makeController(NETWORK, true);
    await c.load();
    const dash = renderDashboard(c, null, () => {});
    const lines = sponsorLines(dash);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(DISCLOSURE);
    const lockup = dash.querySelector<HTMLElement>('.wv2-ph-cash')!;
    expect(lockup.lastElementChild).toBe(lines[0]);
    expect(lines[0].previousElementSibling?.className).toBe('wv2-ph-cash-sub');
    expect(lines[0].classList.contains('wv2-sponsor-card')).toBe(true);
  });

  it('shared giveaway (physical prize): sponsor line sits under the title/value lockup', async () => {
    const c = makeController(
      { ...NETWORK, prizeDescription: 'Amazon Gift Card', prizeValue: 500 },
      true
    );
    await c.load();
    const dash = renderDashboard(c, null, () => {});
    const lines = sponsorLines(dash);
    expect(lines).toHaveLength(1);
    const lockup = dash.querySelector<HTMLElement>('.wv2-ph-prize')!;
    expect(lockup.lastElementChild).toBe(lines[0]);
  });
});

/** A claim block exactly as the backend emits it: no sponsor fields unless network. */
const claimFor = (g: Giveaway): PrizeClaimBlock => ({
  status: 'pending',
  giveawayId: g.id,
  prizeDescription: g.prizeDescription,
  prizeValue: g.prizeValue,
});

/** 3.3.0+ backend: a network win carries the sponsor line on the claim itself. */
const networkClaim: PrizeClaimBlock = {
  ...claimFor(NETWORK),
  scope: 'network',
  sponsorDisclosure: DISCLOSURE,
};

describe('PrizeClaimBlock type: scope + sponsorDisclosure', () => {
  it('both fields are undefined on an exclusive claim block (JSON round-trip)', () => {
    const parsed = JSON.parse(JSON.stringify(claimFor(EXCLUSIVE))) as PrizeClaimBlock;
    expect(parsed.scope).toBeUndefined();
    expect(parsed.sponsorDisclosure).toBeUndefined();
    expect('scope' in parsed).toBe(false);
    expect('sponsorDisclosure' in parsed).toBe(false);
  });

  it('both fields survive a JSON round-trip on a network claim block', () => {
    const parsed = JSON.parse(JSON.stringify(networkClaim)) as PrizeClaimBlock;
    expect(parsed.scope).toBe('network');
    expect(parsed.sponsorDisclosure).toBe(DISCLOSURE);
    expect(parsed.giveawayId).toBe(NETWORK.id);
  });
});

describe('sponsorDisclosureSource (claim block first, served giveaway as fallback)', () => {
  it('claim block with a line wins, whatever the served giveaway is', () => {
    expect(sponsorDisclosureSource(networkClaim, null)).toBe(networkClaim);
    expect(sponsorDisclosureSource(networkClaim, EXCLUSIVE)).toBe(networkClaim);
    expect(sponsorDisclosureSource(networkClaim, { ...NETWORK, sponsorDisclosure: 'Other' })).toBe(
      networkClaim
    );
  });

  it('block without a line: falls back to the served giveaway ONLY when ids match', () => {
    const bare = claimFor(NETWORK);
    expect(sponsorDisclosureSource(bare, NETWORK)).toBe(NETWORK);
    expect(sponsorDisclosureSource(bare, EXCLUSIVE)).toBeNull();
    expect(sponsorDisclosureSource(bare, null)).toBeNull();
    expect(sponsorDisclosureSource(bare, undefined)).toBeNull();
  });

  it('a blank line on the block does not count as present', () => {
    const blank: PrizeClaimBlock = { ...claimFor(NETWORK), sponsorDisclosure: '   ' };
    expect(sponsorDisclosureSource(blank, NETWORK)).toBe(NETWORK);
    expect(sponsorDisclosureSource(blank, null)).toBeNull();
  });
});

describe('Winner splash (renderWinnerSplash)', () => {
  it('exclusive giveaway: claim strip carries no sponsor element', async () => {
    const c = makeController(EXCLUSIVE, true, { prizeClaim: claimFor(EXCLUSIVE) });
    await c.load();
    const splash = renderWinnerSplash(c, claimFor(EXCLUSIVE), null);
    expect(sponsorLines(splash)).toHaveLength(0);
    expect(splash.querySelector('.wv2-claim-strip')!.children.length).toBe(0);
  });

  it('network claim block, NO served giveaway (production: the draw cleared the pointer)', async () => {
    const c = makeController(null, true, { prizeClaim: networkClaim });
    await c.load();
    expect(c.giveaway).toBeNull();
    const splash = renderWinnerSplash(c, networkClaim, null);
    const lines = sponsorLines(splash);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(DISCLOSURE);
    expect(lines[0].classList.contains('wv2-sponsor-strip')).toBe(true);
    expect(lines[0].parentElement?.classList.contains('wv2-claim-strip')).toBe(true);
  });

  it('network claim block, served giveaway is a DIFFERENT one: the block line still shows', async () => {
    const c = makeController(EXCLUSIVE, true, { prizeClaim: networkClaim });
    await c.load();
    expect(c.giveaway?.id).toBe(EXCLUSIVE.id);
    const splash = renderWinnerSplash(c, networkClaim, null);
    const lines = sponsorLines(splash);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(DISCLOSURE);
  });

  it('block line beats the served giveaway line when both exist', async () => {
    const c = makeController({ ...NETWORK, sponsorDisclosure: 'Sponsored by Someone Else' }, true, {
      prizeClaim: networkClaim,
    });
    await c.load();
    const splash = renderWinnerSplash(c, networkClaim, null);
    const lines = sponsorLines(splash);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(DISCLOSURE);
  });

  it('block line is set as text, never parsed as markup', async () => {
    const hostile = '<img src=x onerror="alert(1)">Sponsored';
    const c = makeController(null, true, {
      prizeClaim: { ...networkClaim, sponsorDisclosure: hostile },
    });
    await c.load();
    const splash = renderWinnerSplash(c, { ...networkClaim, sponsorDisclosure: hostile }, null);
    const lines = sponsorLines(splash);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(hostile);
    expect(lines[0].querySelector('img')).toBeNull();
  });

  it('legacy fallback: block without a line, served giveaway IS the network one → its line shows', async () => {
    const c = makeController(NETWORK, true, { prizeClaim: claimFor(NETWORK) });
    await c.load();
    const splash = renderWinnerSplash(c, claimFor(NETWORK), null);
    const lines = sponsorLines(splash);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(DISCLOSURE);
    expect(lines[0].parentElement?.classList.contains('wv2-claim-strip')).toBe(true);
  });

  it('block without a line, claim for a DIFFERENT giveaway than the served one: nothing is shown', async () => {
    const c = makeController(NETWORK, true, { prizeClaim: claimFor(EXCLUSIVE) });
    await c.load();
    const splash = renderWinnerSplash(c, claimFor(EXCLUSIVE), null);
    expect(sponsorLines(splash)).toHaveLength(0);
  });
});
