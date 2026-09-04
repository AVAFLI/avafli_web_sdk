/**
 * Publisher-logo node cache.
 *
 * The V2 root re-renders the whole sheet on every controller state change,
 * and several changes land in the first second of an open (loading →
 * dashboard → celebration). Building a fresh <img> each time made the header
 * logo re-decode and blink. One node per (url, slot) is created once, decoded
 * eagerly the moment the branding config arrives, and then MOVED between
 * renders — a moved node never re-decodes, so the logo is stable from its
 * first paint. Slots exist because the sheet header and the winner-claim
 * header can be on screen at the same time.
 */
export type LogoSlot = 'sheet' | 'claim';

const nodes = new Map<string, HTMLImageElement>();

function keyFor(url: string, slot: LogoSlot): string {
  return `${slot}|${url}`;
}

/** Create (once) and return the shared <img> for this logo url + slot. */
export function logoNode(url: string, slot: LogoSlot): HTMLImageElement {
  const key = keyFor(url, slot);
  let img = nodes.get(key);
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    img.decoding = 'sync';
    img.loading = 'eager';
    img.src = url;
    nodes.set(key, img);
  }
  return img;
}

/**
 * Warm both slots as soon as a logo url is known so the first header paint
 * comes from an already-decoded image. Failures are irrelevant here — the
 * header still renders the <img>, which then loads on its own.
 */
export function preloadLogo(url: string | null | undefined): void {
  if (!url) return;
  for (const slot of ['sheet', 'claim'] as const) {
    const img = logoNode(url, slot);
    if (typeof img.decode === 'function') {
      img.decode().catch(() => { /* decoded lazily on first paint instead */ });
    }
  }
}

/** Test seam. */
export function _resetLogoCache(): void {
  nodes.clear();
}
