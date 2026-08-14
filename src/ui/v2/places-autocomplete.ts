import { logger } from '../../services/logger';

/**
 * Google Places (New) address autocomplete for the claim flow's street field.
 *
 * Enabled ONLY when the server sends `sdkConfig.placesApiKey`; without a key
 * the claim form renders exactly the plain fields it always has. Plain REST
 * calls (no Google SDK): places:autocomplete as the user types, then a place
 * details lookup on selection to fill street/city/state/zip. Every failure —
 * network, quota, malformed payload — degrades silently to plain typing
 * (debug log only); the feature never blocks form entry.
 */

// ─── Tunables (exported for tests) ───

/** No lookups until the street input has at least this many characters. */
export const PLACES_MIN_INPUT_CHARS = 3;

/** Trailing debounce on keystrokes before an autocomplete request fires. */
export const PLACES_DEBOUNCE_MS = 300;

/** At most this many suggestions render in the dropdown. */
export const PLACES_MAX_SUGGESTIONS = 5;

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places/';

// ─── REST payload shapes (the slices this module reads) ───

export interface PlaceSuggestion {
  placeId: string;
  /** The full prediction line, e.g. "123 Main St, Springfield, IL, USA". */
  text: string;
}

/** One `addressComponents[]` entry from the place-details response. */
export interface PlaceAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** The four claim-form address fields an autocomplete selection fills. */
export interface PlaceAddress {
  /** "street_number route" — either part may be absent. */
  street: string;
  /** locality, else sublocality, else postal_town. */
  city: string;
  /** administrative_area_level_1 shortText ("NY"). */
  state: string;
  /** postal_code, or '' when Google omits it. */
  zip: string;
}

/** fetch with an optional injection seam for tests. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ─── REST calls ───

/**
 * POST places:autocomplete for `input`, US-only, constrained to street-level
 * results. Resolves with up to {@link PLACES_MAX_SUGGESTIONS} suggestions;
 * throws on HTTP/transport errors (callers degrade silently).
 */
export async function fetchPlaceSuggestions(
  apiKey: string,
  input: string,
  fetchFn?: FetchLike
): Promise<PlaceSuggestion[]> {
  const doFetch: FetchLike = fetchFn ?? ((url, init) => fetch(url, init));
  const response = await doFetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({
      input,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
    }),
  });
  if (!response.ok) throw new Error(`places:autocomplete HTTP ${response.status}`);
  const payload = (await response.json()) as {
    suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
  };
  const suggestions: PlaceSuggestion[] = [];
  for (const entry of payload?.suggestions ?? []) {
    const placeId = entry?.placePrediction?.placeId;
    const text = entry?.placePrediction?.text?.text;
    if (typeof placeId === 'string' && placeId && typeof text === 'string' && text) {
      suggestions.push({ placeId, text });
      if (suggestions.length >= PLACES_MAX_SUGGESTIONS) break;
    }
  }
  return suggestions;
}

/**
 * addressComponents → the claim form's four address fields. Missing
 * components map to '' — the caller decides what to overwrite.
 */
export function mapAddressComponents(components: PlaceAddressComponent[]): PlaceAddress {
  const find = (type: string): PlaceAddressComponent | undefined =>
    components.find((component) => component.types?.includes(type));
  const streetNumber = find('street_number')?.longText ?? '';
  const route = find('route')?.longText ?? '';
  const city =
    find('locality')?.longText ??
    find('sublocality')?.longText ??
    find('postal_town')?.longText ??
    '';
  return {
    street: [streetNumber, route].filter(Boolean).join(' '),
    city,
    state: find('administrative_area_level_1')?.shortText ?? '',
    zip: find('postal_code')?.longText ?? '',
  };
}

/**
 * GET place details (addressComponents field mask only — the cheapest SKU
 * that answers the form) and map them to {@link PlaceAddress}. Throws on
 * HTTP/transport errors.
 */
export async function fetchPlaceAddress(
  apiKey: string,
  placeId: string,
  fetchFn?: FetchLike
): Promise<PlaceAddress> {
  const doFetch: FetchLike = fetchFn ?? ((url, init) => fetch(url, init));
  const response = await doFetch(PLACE_DETAILS_BASE_URL + encodeURIComponent(placeId), {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'addressComponents',
    },
  });
  if (!response.ok) throw new Error(`place details HTTP ${response.status}`);
  const payload = (await response.json()) as { addressComponents?: PlaceAddressComponent[] };
  return mapAddressComponents(
    Array.isArray(payload?.addressComponents) ? payload.addressComponents : []
  );
}

// ─── State code → full name (the form's state <select> uses full names) ───

const US_STATE_NAMES_BY_CODE: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/**
 * "NY" → "New York" (the value the state <select> and backend normalization
 * expect). Undefined for anything that isn't one of the 50 states + DC.
 */
export function stateNameFromShortCode(code: string): string | undefined {
  return US_STATE_NAMES_BY_CODE[code.trim().toUpperCase()];
}

// ─── DOM wiring ───

export interface PlacesAutocompleteOptions {
  /** Absent/empty → the feature is OFF and the input is left untouched. */
  apiKey: string | null | undefined;
  /** The street-address input to augment (its parent anchors the dropdown). */
  input: HTMLInputElement;
  /** Fired after a suggestion's details resolve — fill the form fields here. */
  onAddress: (address: PlaceAddress) => void;
  /** Test seam; defaults to the global fetch. */
  fetchFn?: FetchLike;
}

export interface PlacesAutocompleteHandle {
  destroy(): void;
}

/**
 * Wires Places autocomplete onto a street input: a debounced (300ms, min 3
 * chars) suggestion dropdown styled like the claim form's dark fields,
 * keyboard-navigable (arrows + Enter), dismissable (Escape/blur), with the
 * required "powered by Google" attribution. Returns null — and changes
 * NOTHING about the input — when no API key is configured.
 */
export function attachPlacesAutocomplete(
  options: PlacesAutocompleteOptions
): PlacesAutocompleteHandle | null {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;
  const { input } = options;
  const anchor = input.parentElement;
  if (!anchor) return null;
  const fetchFn: FetchLike = options.fetchFn ?? ((url, init) => fetch(url, init));

  // Our dropdown replaces the browser's address autofill popup (the two
  // would stack); plain typing still works exactly as before.
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  anchor.classList.add('wv2-places-anchor');
  const dropdown = document.createElement('div');
  dropdown.className = 'wv2-places-dd';
  dropdown.setAttribute('role', 'listbox');
  dropdown.style.display = 'none';
  anchor.appendChild(dropdown);

  let items: PlaceSuggestion[] = [];
  let itemEls: HTMLElement[] = [];
  let activeIndex = -1;
  /** Bumped on every keystroke/selection/close so stale responses drop. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const isOpen = (): boolean => dropdown.style.display !== 'none';

  const close = (): void => {
    dropdown.style.display = 'none';
    dropdown.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    items = [];
    itemEls = [];
    activeIndex = -1;
  };

  const setActive = (index: number): void => {
    activeIndex = index;
    itemEls.forEach((elm, i) => {
      elm.classList.toggle('wv2-active', i === activeIndex);
      elm.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    });
  };

  const select = (item: PlaceSuggestion): void => {
    generation++;
    close();
    void (async (): Promise<void> => {
      try {
        const address = await fetchPlaceAddress(apiKey, item.placeId, fetchFn);
        options.onAddress(address);
      } catch (error) {
        // Degrade silently — whatever the user typed stays editable.
        logger.debug('Place details lookup failed (plain typing continues):', error);
      }
    })();
  };

  const render = (suggestions: PlaceSuggestion[]): void => {
    dropdown.textContent = '';
    items = suggestions;
    itemEls = [];
    activeIndex = -1;
    suggestions.forEach((suggestion) => {
      const item = document.createElement('div');
      item.className = 'wv2-places-item';
      item.setAttribute('role', 'option');
      item.textContent = suggestion.text;
      // mousedown would steal focus and fire blur before click — suppress it
      // so the click lands while the dropdown is still open.
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', () => select(suggestion));
      dropdown.appendChild(item);
      itemEls.push(item);
    });
    // Required attribution when suggestions render outside a Google widget.
    dropdown.appendChild(
      Object.assign(document.createElement('div'), {
        className: 'wv2-places-attrib',
        textContent: 'powered by Google',
      })
    );
    dropdown.style.display = '';
    input.setAttribute('aria-expanded', 'true');
  };

  const query = async (gen: number, value: string): Promise<void> => {
    try {
      const suggestions = await fetchPlaceSuggestions(apiKey, value, fetchFn);
      if (gen !== generation) return; // stale — a newer keystroke/selection won
      if (suggestions.length === 0) {
        close();
      } else {
        render(suggestions);
      }
    } catch (error) {
      logger.debug('Places autocomplete lookup failed (plain typing continues):', error);
      if (gen === generation) close();
    }
  };

  const onInput = (): void => {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const value = input.value.trim();
    if (value.length < PLACES_MIN_INPUT_CHARS) {
      close();
      return;
    }
    const gen = generation;
    timer = setTimeout(() => {
      timer = null;
      void query(gen, value);
    }, PLACES_DEBOUNCE_MS);
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen()) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIndex + 1 >= items.length ? 0 : activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < items.length) {
        e.preventDefault();
        select(items[activeIndex]!);
      }
    } else if (e.key === 'Escape') {
      // Swallow it: dismiss only the dropdown, not the whole experience
      // (the root listens for Escape on document).
      e.preventDefault();
      e.stopPropagation();
      generation++;
      close();
    }
  };

  const onBlur = (): void => {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    close();
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', onBlur);

  return {
    destroy(): void {
      generation++;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
      dropdown.remove();
      anchor.classList.remove('wv2-places-anchor');
    },
  };
}
