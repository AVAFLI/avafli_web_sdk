/**
 * Image prewarmer — shared by the boot chunk (publisher art is warmed at
 * registration / every giveaway refresh) and the UI chunk. Lives outside
 * src/ui so the boot path never pulls the drawer in.
 */

/** URLs already decoded (or in flight) — a repeated refresh is a no-op. */
const warmedImageUrls = new Set<string>();

/**
 * Pulls a remote image into the browser's HTTP/image cache ahead of the
 * drawer opening, so the prize card paints its art on its FIRST frame instead
 * of popping in a beat after everything else.
 *
 * The SDK learns `prizeImageUrl` (and `branding.logoUrl`) at registration /
 * giveaway refresh — long before the experience is presented — which is
 * exactly the moment to pay the download. Fire-and-forget: a failure just
 * means the widget loads it normally, and the URL is dropped from the warmed
 * set so the next refresh can retry.
 *
 * Safe in non-DOM/SSR environments (no `Image` constructor → no-op).
 */
export function prewarmImage(url?: string | null): void {
  if (!url) return;
  if (typeof Image === 'undefined') return; // SSR / non-DOM host
  if (warmedImageUrls.has(url)) return;
  warmedImageUrls.add(url);

  const forget = (): void => {
    warmedImageUrls.delete(url); // allow a retry on the next refresh
  };

  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    // decode() resolves once the bytes are downloaded AND decoded, which is
    // what actually makes the later <img> paint synchronously. Not every
    // engine implements it — a plain load/error pair is the fallback.
    if (typeof img.decode === 'function') {
      void img.decode().catch(forget);
    } else {
      img.onerror = forget;
    }
  } catch {
    forget();
  }
}

/** @internal — whether {@link prewarmImage} has already warmed this URL. */
export function isImageWarmed(url: string): boolean {
  return warmedImageUrls.has(url);
}

/** @internal — test hook; clears the warmed-URL set. */
export function resetImageWarmer(): void {
  warmedImageUrls.clear();
}
