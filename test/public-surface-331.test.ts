// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as esm from '../src/index';
import umd from '../src/umd';

/**
 * 3.3.1 — the host-page surface (source-level view; the built bundles and
 * the published `.d.ts` are checked in test/bundle-size.test.ts).
 *
 * `optOut()` is REMOVED: a host page must not be able to erase a person's
 * Avafli data. Deletion is self-serve from the Privacy Policy screen inside
 * the experience (the legal overlay's delete bridge → the drawer's
 * confirmation → the internal `optOutFromExperience`), with the 24-hour
 * rejoin unchanged. Neither the ESM `Avafli` class nor the UMD global
 * carries the method any more.
 */

const PUBLIC_STATICS = [
  'configure',
  'present',
  'holdAutoOpen',
  'releaseAutoOpen',
  'dismiss',
  'refreshConfig',
  'registerForPushNotifications',
] as const;

describe('3.3.1 public surface', () => {
  it('ESM entry: Avafli has no optOut; the documented statics remain', () => {
    const cls = esm.Avafli as unknown as Record<string, unknown>;
    expect('optOut' in cls).toBe(false);
    expect(cls['optOut']).toBeUndefined();
    for (const name of PUBLIC_STATICS) expect(typeof cls[name], name).toBe('function');
    expect(typeof Object.getOwnPropertyDescriptor(esm.Avafli, 'isAvailable')?.get).toBe('function');
    expect(typeof Object.getOwnPropertyDescriptor(esm.Avafli, 'unavailableReason')?.get).toBe('function');
    // deleteUserData was removed long ago — it must not come back either.
    expect('deleteUserData' in cls).toBe(false);
  });

  it('UMD global: the class itself is the global, without optOut', () => {
    const global = umd as unknown as Record<string, unknown>;
    expect(global).toBe(esm.Avafli);
    expect('optOut' in global).toBe(false);
    for (const name of PUBLIC_STATICS) expect(typeof global[name], name).toBe('function');
    // The attached runtime exports are still there.
    expect(global['AvafliError']).toBe(esm.AvafliError);
    expect(global['AVAFLI_CONSTANTS']).toBe(esm.AVAFLI_CONSTANTS);
    expect(global['Avafli']).toBe(esm.Avafli);
  });

  it('the in-drawer erasure path still exists (it is what the legal overlay\'s delete bridge reaches)', () => {
    const cls = esm.Avafli as unknown as Record<string, unknown>;
    expect(typeof cls['optOutFromExperience']).toBe('function');
  });
});
