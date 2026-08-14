// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PLACES_DEBOUNCE_MS,
  PLACES_MAX_SUGGESTIONS,
  PLACES_MIN_INPUT_CHARS,
  PlaceAddressComponent,
  attachPlacesAutocomplete,
  mapAddressComponents,
  stateNameFromShortCode,
} from '../src/ui/v2/places-autocomplete';

/**
 * Google Places address autocomplete (claim step 2, sdkConfig.placesApiKey):
 *  - lookups are debounced (~300ms) and only fire at 3+ typed characters;
 *  - addressComponents map to the form's street/city/state/zip (state as the
 *    administrative_area_level_1 shortText; a missing postal_code maps to '');
 *  - WITHOUT a key the feature is entirely off — no dropdown, no requests,
 *    the input untouched (today's plain fields, exactly);
 *  - failures degrade silently to plain typing.
 */

// ─── Fetch fixtures ───

const SUGGESTIONS_PAYLOAD = {
  suggestions: [
    {
      placePrediction: {
        placeId: 'place-1',
        text: { text: '12 Analytical Way, Brooklyn, NY, USA' },
      },
    },
    {
      placePrediction: {
        placeId: 'place-2',
        text: { text: '12 Analytical Way, Troy, NY, USA' },
      },
    },
  ],
};

const DETAILS_PAYLOAD = {
  addressComponents: [
    { longText: '12', shortText: '12', types: ['street_number'] },
    { longText: 'Analytical Way', shortText: 'Analytical Way', types: ['route'] },
    { longText: 'Brooklyn', shortText: 'Brooklyn', types: ['sublocality_level_1', 'sublocality'] },
    { longText: 'New York', shortText: 'NY', types: ['administrative_area_level_1'] },
    { longText: 'United States', shortText: 'US', types: ['country'] },
    { longText: '11201', shortText: '11201', types: ['postal_code'] },
  ],
};

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

/** A fetch mock that answers autocomplete POSTs and details GETs. */
function makeFetch(
  suggestions: unknown = SUGGESTIONS_PAYLOAD,
  details: unknown = DETAILS_PAYLOAD
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) =>
    url.includes(':autocomplete') ? jsonResponse(suggestions) : jsonResponse(details)
  );
}

/** A street input inside its .wv2-sf wrapper, as stepField builds it. */
function makeInput(): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement('div');
  wrap.className = 'wv2-sf';
  const input = document.createElement('input');
  input.setAttribute('autocomplete', 'address-line1');
  wrap.appendChild(input);
  document.body.appendChild(wrap);
  return { wrap, input };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('component mapping', () => {
  it('maps street/city/state/zip from addressComponents (state = shortText)', () => {
    expect(mapAddressComponents(DETAILS_PAYLOAD.addressComponents)).toEqual({
      street: '12 Analytical Way',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11201',
    });
  });

  it('a missing postal_code maps to an empty zip (the user types it)', () => {
    const components = DETAILS_PAYLOAD.addressComponents.filter(
      (component) => !component.types.includes('postal_code')
    );
    expect(mapAddressComponents(components).zip).toBe('');
  });

  it('city prefers locality, then sublocality, then postal_town', () => {
    const base: PlaceAddressComponent[] = [
      { longText: 'Springfield', types: ['locality', 'political'] },
      { longText: 'Downtown', types: ['sublocality_level_1', 'sublocality'] },
      { longText: 'Postal Springfield', types: ['postal_town'] },
    ];
    expect(mapAddressComponents(base).city).toBe('Springfield');
    expect(mapAddressComponents(base.slice(1)).city).toBe('Downtown');
    expect(mapAddressComponents(base.slice(2)).city).toBe('Postal Springfield');
    expect(mapAddressComponents([]).city).toBe('');
  });

  it('state shortText resolves to the full name the state <select> uses', () => {
    expect(stateNameFromShortCode('NY')).toBe('New York');
    expect(stateNameFromShortCode('dc')).toBe('District of Columbia');
    expect(stateNameFromShortCode('PR')).toBeUndefined();
    expect(stateNameFromShortCode('')).toBeUndefined();
  });
});

describe('suggestion fetch: debounce + threshold', () => {
  it('never fetches below the 3-character threshold', async () => {
    const fetchFn = makeFetch();
    const { input } = makeInput();
    attachPlacesAutocomplete({ apiKey: 'k', input, onAddress: vi.fn(), fetchFn });

    type(input, '1');
    type(input, '12');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS * 3);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(input.value.length).toBeLessThan(PLACES_MIN_INPUT_CHARS);
  });

  it('a keystroke burst debounces into ONE request for the latest text', async () => {
    const fetchFn = makeFetch();
    const { input } = makeInput();
    attachPlacesAutocomplete({ apiKey: 'key-123', input, onAddress: vi.fn(), fetchFn });

    type(input, '12 A');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS - 50);
    type(input, '12 Ana');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS - 50);
    type(input, '12 Analytical');
    expect(fetchFn).not.toHaveBeenCalled(); // still inside the debounce window

    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Exact request contract: POST, key header, US-only street-level body.
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'X-Goog-Api-Key': 'key-123',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      input: '12 Analytical',
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
    });
  });

  it('renders at most 5 suggestions plus the "powered by Google" attribution', async () => {
    const many = {
      suggestions: Array.from({ length: 8 }, (_, i) => ({
        placePrediction: { placeId: `p${i}`, text: { text: `${i} Main St, Troy, NY, USA` } },
      })),
    };
    const fetchFn = makeFetch(many);
    const { wrap, input } = makeInput();
    attachPlacesAutocomplete({ apiKey: 'k', input, onAddress: vi.fn(), fetchFn });

    type(input, '123 Main');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS);

    const items = wrap.querySelectorAll('.wv2-places-item');
    expect(items).toHaveLength(PLACES_MAX_SUGGESTIONS);
    expect(items[0]?.textContent).toBe('0 Main St, Troy, NY, USA');
    expect(wrap.querySelector('.wv2-places-attrib')?.textContent).toBe('powered by Google');
  });

  it('a fetch failure degrades silently — no dropdown, typing untouched', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const { wrap, input } = makeInput();
    attachPlacesAutocomplete({ apiKey: 'k', input, onAddress: vi.fn(), fetchFn });

    type(input, '123 Main St');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS);
    expect(wrap.querySelectorAll('.wv2-places-item')).toHaveLength(0);
    expect(input.value).toBe('123 Main St'); // form entry never blocked
  });
});

describe('selection → place details → four fields', () => {
  it('clicking a suggestion GETs details with the field mask and reports the mapped address', async () => {
    const fetchFn = makeFetch();
    const onAddress = vi.fn();
    const { wrap, input } = makeInput();
    attachPlacesAutocomplete({ apiKey: 'key-123', input, onAddress, fetchFn });

    type(input, '12 Analytical');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS);
    (wrap.querySelector('.wv2-places-item') as HTMLElement).click();
    await vi.runAllTimersAsync();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places/place-1');
    expect(init.headers).toMatchObject({
      'X-Goog-Api-Key': 'key-123',
      'X-Goog-FieldMask': 'addressComponents',
    });
    expect(onAddress).toHaveBeenCalledWith({
      street: '12 Analytical Way',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11201',
    });
    // Selection closes the dropdown.
    expect(wrap.querySelectorAll('.wv2-places-item')).toHaveLength(0);
  });

  it('keyboard: arrows move the highlight, Enter selects, Escape only closes the dropdown', async () => {
    const fetchFn = makeFetch();
    const onAddress = vi.fn();
    const { wrap, input } = makeInput();
    attachPlacesAutocomplete({ apiKey: 'k', input, onAddress, fetchFn });

    type(input, '12 Analytical');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(wrap.querySelectorAll('.wv2-places-item')[1]?.classList.contains('wv2-active')).toBe(
      true
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.runAllTimersAsync();
    // Second suggestion selected → its details were fetched.
    expect((fetchFn.mock.calls[1] as [string, RequestInit])[0]).toContain('place-2');
    expect(onAddress).toHaveBeenCalledOnce();

    // Reopen, then Escape: dropdown closes and the key never bubbles to the
    // document (the experience root's Escape-dismiss must not fire).
    type(input, '12 Analytical W');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS);
    expect(wrap.querySelectorAll('.wv2-places-item').length).toBeGreaterThan(0);
    const documentEscape = vi.fn();
    document.addEventListener('keydown', documentEscape);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrap.querySelectorAll('.wv2-places-item')).toHaveLength(0);
    expect(documentEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentEscape);
  });
});

describe('absent key = feature off', () => {
  it('returns null and changes nothing: no dropdown, no requests, attributes untouched', async () => {
    const fetchFn = makeFetch();
    const { wrap, input } = makeInput();
    const handle = attachPlacesAutocomplete({
      apiKey: undefined,
      input,
      onAddress: vi.fn(),
      fetchFn,
    });

    expect(handle).toBeNull();
    type(input, '123 Main Street');
    await vi.advanceTimersByTimeAsync(PLACES_DEBOUNCE_MS * 3);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(wrap.querySelector('.wv2-places-dd')).toBeNull();
    expect(wrap.classList.contains('wv2-places-anchor')).toBe(false);
    // Today's plain-field behavior, exactly — browser autofill still on.
    expect(input.getAttribute('autocomplete')).toBe('address-line1');
  });

  it('a blank/whitespace key is also off', () => {
    const { input } = makeInput();
    expect(
      attachPlacesAutocomplete({ apiKey: '   ', input, onAddress: vi.fn(), fetchFn: makeFetch() })
    ).toBeNull();
  });
});
