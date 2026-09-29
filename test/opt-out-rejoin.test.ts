// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AvafliV2Strings } from '../src/ui/v2/strings';

/**
 * 3.2.0 — rejoin 24 hours after "Delete my data" (Rules §9).
 *
 * Pins:
 *  - opted out, block still running → nothing changes (the registration
 *    configure() always made, no presentation, present() is a no-op);
 *  - block lapsed → the opt-out AND every piece of the old session are
 *    cleared (the device id is kept), the device registers, and the normal
 *    email-capture flow follows — on configure() and on tab foreground;
 *  - an opt-out cached before 3.2.0 (no time) is stamped and lifts 24 h later;
 *  - the server still reporting the opt-out → its time is adopted, no loop;
 *  - `optOut()` stores the moment the block lifts.
 */

const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

const VALID_USER = { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace' };
const DEVICE_ID = 'web_0123456789abcdef01234567';

const optedOutKey = (bundle: string): string => `winr_opted_out_${bundle}`;
const untilKey = (bundle: string): string => `winr_opted_out_until_${bundle}`;
const emailKey = (bundle: string): string => `winr_email_submitted_${bundle}`;
const markKey = (bundle: string): string => `winr_last_auto_present_${bundle}`;
const claimMarkKey = (bundle: string): string => `winr_last_claim_auto_present_${bundle}`;
const impressionsKey = (bundle: string): string => `winr_unregistered_impressions_${bundle}`;
const adoptionKey = (bundle: string): string => `winr_adoption_code_sent_at_${bundle}`;

function fakeJwt(subject: string): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800, sub: subject })}.sig`;
}

const giveaway = {
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

/** What the backend answers for a tombstoned device inside its 24 hours. */
const stillOptedOut = (until?: number): Record<string, unknown> => ({
  uuid: 'old-user',
  token: fakeJwt('old-user'),
  giveaway,
  isNewUser: false,
  optedOut: true,
  ...(until !== undefined ? { optedOutUntil: iso(until) } : {}),
});

/** What it answers once the block has lifted: a brand-new user. */
const brandNewUser: Record<string, unknown> = {
  uuid: 'new-user',
  token: fakeJwt('new-user'),
  refreshToken: 'rt-new',
  giveaway,
  isNewUser: true,
  optedOut: false,
  emailConsentStatus: false,
};

interface Call {
  url: string;
  data: Record<string, unknown>;
  /** Storage as it stood when the request went out. */
  local: Record<string, string>;
  session: Record<string, string>;
}

let calls: Call[];
/** The registerDevice answer; swap it mid-test to move the server on. */
let registerAnswer: Record<string, unknown>;
let optOutAnswer: Record<string, unknown>;
/** Extra fields on the getActiveGiveaway answer. */
let giveawayAnswer: Record<string, unknown>;

function snapshot(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) out[key] = storage.getItem(key) ?? '';
  }
  return out;
}

function installFetch(): void {
  calls = [];
  (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
    async (url: unknown, init?: RequestInit) => {
      const respond = (result: unknown) =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ result }),
          text: async () => JSON.stringify({ result }),
        }) as unknown as Response;
      const u = String(url);
      const data =
        (JSON.parse(String(init?.body ?? '{}')) as { data?: Record<string, unknown> }).data ?? {};
      calls.push({ url: u, data, local: snapshot(localStorage), session: snapshot(sessionStorage) });
      if (u.includes('/registerDevice')) {
        return respond({
          refreshToken: 'rt',
          isReturningUser: false,
          claimedToday: false,
          streakDay: 1,
          totalEntries: 0,
          sdkConfig: { experience: { autoOpenEnabled: true, unregisteredImpressionCap: 3 } },
          ...registerAnswer,
        });
      }
      if (u.includes('/getActiveGiveaway')) {
        return respond({
          giveaway,
          sdkConfig: null,
          claimedToday: false,
          streakDay: 1,
          totalEntries: 0,
          emailConsentStatus: false,
          optedOut: false,
          ...giveawayAnswer,
        });
      }
      if (u.includes('/optOut')) return respond(optOutAnswer);
      return respond({ success: true });
    }
  );
}

const registerCalls = (bundle: string): Call[] =>
  calls.filter((c) => c.url.includes('/registerDevice') && c.data['bundleId'] === bundle);

/** Everything a previous session of `bundle` left behind, plus the opt-out. */
function seedOptedOutSession(bundle: string, until: number | null): void {
  localStorage.setItem('winr_device_fingerprint', DEVICE_ID);
  localStorage.setItem(optedOutKey(bundle), 'true');
  if (until !== null) localStorage.setItem(untilKey(bundle), iso(until));
  localStorage.setItem(emailKey(bundle), 'true');
  localStorage.setItem('winr_cached_giveaway', JSON.stringify(giveaway));
  localStorage.setItem(
    'winr_streak_state',
    JSON.stringify({ currentDay: 9, totalEntriesEarned: 600, lastClaimedDate: iso(NOW - 2 * DAY) })
  );
  localStorage.setItem('winr_last_claim_date', iso(NOW - 2 * DAY));
  localStorage.setItem(markKey(bundle), '2026-09-27');
  localStorage.setItem(claimMarkKey(bundle), String(NOW - 2 * DAY));
  localStorage.setItem(impressionsKey(bundle), '2');
  localStorage.setItem(adoptionKey(bundle), String(NOW - 2 * DAY));
  sessionStorage.setItem('winr_token', fakeJwt('old-user'));
  sessionStorage.setItem('winr_refresh_token', 'rt-old');
  sessionStorage.setItem('winr_uuid', 'old-user');
}

/** The keys the lift must clear (the device id is NOT among them). */
const clearedLocalKeys = (bundle: string): string[] => [
  optedOutKey(bundle),
  untilKey(bundle),
  emailKey(bundle),
  'winr_cached_giveaway',
  'winr_streak_state',
  'winr_last_claim_date',
  markKey(bundle),
  claimMarkKey(bundle),
  impressionsKey(bundle),
  adoptionKey(bundle),
];
const clearedSessionKeys = ['winr_token', 'winr_refresh_token', 'winr_uuid'];

async function sdk() {
  const { Avafli } = await import('../src/index');
  return Avafli;
}

async function configureSDK(bundle: string): Promise<void> {
  const Avafli = await sdk();
  await Avafli.configure({ apiKey: 'k', bundleId: bundle, user: { ...VALID_USER } });
}

const host = (): Element | null => document.querySelector('[data-winr="v2"]');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
const foreground = async (): Promise<void> => {
  window.dispatchEvent(new Event('focus'));
  await settle();
};

describe('3.2.0 rejoin 24 hours after "Delete my data"', () => {
  // Focus/visibility listeners outlive vi.resetModules() — drop the ones each
  // test attached, so an earlier test's SDK never answers a later test's focus.
  let attached: Array<[EventTarget, string, EventListenerOrEventListenerObject]>;

  beforeEach(() => {
    vi.resetModules();
    // Only the clock is faked: the SDK's promises and timers run for real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    sessionStorage.clear();
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    registerAnswer = brandNewUser;
    optOutAnswer = { success: true };
    giveawayAnswer = {};
    installFetch();

    attached = [];
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        attached.push([target, type, listener]);
        add(type, listener, options);
      }) as typeof target.addEventListener);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    attached.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
    vi.useRealTimers();
  });

  it('opted out, block still running → nothing changes: no presentation, present() is a no-op', async () => {
    const bundle = 'com.rejoin.running';
    const until = NOW + 5 * HOUR;
    seedOptedOutSession(bundle, until);
    registerAnswer = stillOptedOut(until);
    const before = snapshot(localStorage);

    await configureSDK(bundle);
    await settle();

    // The one registration configure() has always made — nothing more.
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(registerCalls(bundle)[0]!.local).toEqual(before);
    expect(host()).toBeNull();

    // Every piece of the old session the lift would clear is still there.
    for (const key of clearedLocalKeys(bundle)) {
      expect(localStorage.getItem(key), key).toBe(before[key]);
    }
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(until));

    const Avafli = await sdk();
    await expect(Avafli.present()).resolves.toBe(false);
    await foreground();
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(host()).toBeNull();
  });

  it('block lapsed → old session cleared key by key, device id kept, registers, normal flow follows', async () => {
    const bundle = 'com.rejoin.lapsed';
    seedOptedOutSession(bundle, NOW - 1000);

    await configureSDK(bundle);

    expect(registerCalls(bundle)).toHaveLength(1);
    const atRegister = registerCalls(bundle)[0]!;
    // Cleared BEFORE the registration went out…
    for (const key of clearedLocalKeys(bundle)) {
      expect(atRegister.local[key], key).toBeUndefined();
    }
    for (const key of clearedSessionKeys) {
      expect(atRegister.session[key], key).toBeUndefined();
    }
    // …all but the device id, which registers the same device.
    expect(atRegister.local['winr_device_fingerprint']).toBe(DEVICE_ID);
    expect(atRegister.data['deviceFingerprint']).toBe(DEVICE_ID);

    // A brand-new participant: new session, no opt-out, no email on file.
    expect(sessionStorage.getItem('winr_uuid')).toBe('new-user');
    expect(sessionStorage.getItem('winr_token')).toBe(fakeJwt('new-user'));
    expect(localStorage.getItem(optedOutKey(bundle))).toBeNull();
    expect(localStorage.getItem(untilKey(bundle))).toBeNull();
    expect(localStorage.getItem(emailKey(bundle))).toBeNull();
    expect(localStorage.getItem(impressionsKey(bundle))).toBeNull();
    expect(localStorage.getItem(adoptionKey(bundle))).toBeNull();
    expect(JSON.parse(localStorage.getItem('winr_streak_state')!)).toMatchObject({
      currentDay: 1,
      totalEntriesEarned: 0,
    });

    // The normal flow: the drawer opens on email capture.
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await vi.waitFor(() =>
      expect(host()!.shadowRoot!.querySelector('input[type="email"]')).not.toBeNull()
    );
  });

  it('block lapses while the page is open → the next tab foreground clears and registers', async () => {
    const bundle = 'com.rejoin.foreground';
    const until = NOW + HOUR;
    seedOptedOutSession(bundle, until);
    registerAnswer = stillOptedOut(until);
    await configureSDK(bundle);
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(host()).toBeNull();

    vi.setSystemTime(until + 1000);
    registerAnswer = brandNewUser;
    await foreground();

    expect(registerCalls(bundle)).toHaveLength(2);
    const atRegister = registerCalls(bundle)[1]!;
    for (const key of [optedOutKey(bundle), untilKey(bundle), emailKey(bundle), markKey(bundle)]) {
      expect(atRegister.local[key], key).toBeUndefined();
    }
    for (const key of clearedSessionKeys) {
      expect(atRegister.session[key], key).toBeUndefined();
    }
    expect(atRegister.data['deviceFingerprint']).toBe(DEVICE_ID);
    expect(sessionStorage.getItem('winr_uuid')).toBe('new-user');
    await vi.waitFor(() => expect(host()).not.toBeNull());

    // One registration for the lift — later foregrounds add none.
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(2);
  });

  it('an opt-out cached before 3.2.0 (no time) is stamped on first sight and lifts 24 hours later', async () => {
    const bundle = 'com.rejoin.legacy';
    seedOptedOutSession(bundle, null);
    registerAnswer = stillOptedOut(); // an older backend: no optedOutUntil
    await configureSDK(bundle);
    await settle();

    expect(localStorage.getItem(optedOutKey(bundle))).toBe('true');
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(NOW + DAY));
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(host()).toBeNull();

    // 23 hours on: still blocked, still quiet.
    vi.setSystemTime(NOW + 23 * HOUR);
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(NOW + DAY));
    expect(host()).toBeNull();

    // 24 hours on: lifted.
    vi.setSystemTime(NOW + DAY);
    registerAnswer = brandNewUser;
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(2);
    expect(localStorage.getItem(optedOutKey(bundle))).toBeNull();
    expect(localStorage.getItem(untilKey(bundle))).toBeNull();
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it("server still reports the opt-out → the server's time is adopted, and nothing loops", async () => {
    const bundle = 'com.rejoin.skew';
    const serverUntil = NOW + 2 * HOUR;
    seedOptedOutSession(bundle, NOW - 1000); // the local clock says: lapsed
    registerAnswer = stillOptedOut(serverUntil);

    await configureSDK(bundle);
    await settle();

    expect(registerCalls(bundle)).toHaveLength(1);
    expect(localStorage.getItem(optedOutKey(bundle))).toBe('true');
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(serverUntil));
    expect(host()).toBeNull();

    const Avafli = await sdk();
    await expect(Avafli.present()).resolves.toBe(false);
    for (let i = 0; i < 4; i++) await foreground();
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(host()).toBeNull();

    // Tried again AFTER the server's time — and only then.
    vi.setSystemTime(serverUntil + 1000);
    registerAnswer = brandNewUser;
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(2);
    expect(localStorage.getItem(optedOutKey(bundle))).toBeNull();
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it('server still opted out with a time that has ALREADY passed here → waits, never loops', async () => {
    const bundle = 'com.rejoin.lag';
    seedOptedOutSession(bundle, NOW - 5000);
    registerAnswer = stillOptedOut(NOW - 5000); // sweep lag / a fast device clock

    await configureSDK(bundle);
    await settle();

    expect(registerCalls(bundle)).toHaveLength(1);
    expect(localStorage.getItem(optedOutKey(bundle))).toBe('true');
    const stored = Date.parse(localStorage.getItem(untilKey(bundle))!);
    expect(stored).toBe(NOW + 15 * 60 * 1000);

    for (let i = 0; i < 4; i++) await foreground();
    expect(registerCalls(bundle)).toHaveLength(1);
    expect(host()).toBeNull();

    // After the wait: one more attempt — and if the server still says no,
    // one more wait. Bounded every time.
    vi.setSystemTime(stored + 1000);
    await foreground();
    await foreground();
    expect(registerCalls(bundle)).toHaveLength(2);
    expect(Date.parse(localStorage.getItem(untilKey(bundle))!)).toBe(
      stored + 1000 + 15 * 60 * 1000
    );
    expect(host()).toBeNull();
  });

  it("optOut() stores when the block lifts: the server's time, else the call's moment + 24 hours", async () => {
    const bundle = 'com.rejoin.optout';
    localStorage.setItem(markKey(bundle), '2026-09-29'); // keep the drawer closed
    await configureSDK(bundle);
    const Avafli = await sdk();

    optOutAnswer = { success: true, optedOut: true, optedOutUntil: iso(NOW + DAY + 1234) };
    await Avafli.optOut();
    expect(localStorage.getItem(optedOutKey(bundle))).toBe('true');
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(NOW + DAY + 1234));
    await expect(Avafli.present()).resolves.toBe(false);

    // An older backend answers without the time.
    localStorage.removeItem(untilKey(bundle));
    optOutAnswer = { success: true };
    await Avafli.optOut();
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(NOW + DAY));
  });

  it('a getActiveGiveaway response carrying optedOutUntil is stored too', async () => {
    const bundle = 'com.rejoin.refresh';
    const until = NOW + 3 * HOUR;
    // Registration knew nothing of it; the drawer's own refresh reports it.
    giveawayAnswer = { optedOut: true, optedOutUntil: iso(until) };
    await configureSDK(bundle);

    await vi.waitFor(() => expect(localStorage.getItem(optedOutKey(bundle))).toBe('true'));
    expect(localStorage.getItem(untilKey(bundle))).toBe(iso(until));
  });
});

describe('3.2.0 delete-my-data copy', () => {
  it('says what is lost and that rejoining is possible after 24 hours', () => {
    expect(AvafliV2Strings.optOutBody).toBe(
      'This permanently erases your information and ends your participation. Entries and streaks are forfeited and cannot be restored. You can join again as a new participant after 24 hours.'
    );
  });
});
