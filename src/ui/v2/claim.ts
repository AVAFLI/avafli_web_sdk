/**
 * Winner prize-claim flow helpers — ported from iOS WINRV2Claim.swift
 * (form model + per-step validation for Joe's stepped Figma flow, photo
 * downscale, "MONTH, YYYY" date display). Kept free of DOM rendering so
 * validation is unit-testable.
 */

// ─── Form model + validation ───

/**
 * The claim form's field values (steps 1-3 + the review consent).
 *
 * NOTE (2.9): the "please share a little" story is NOT part of this form
 * anymore — it is typed on the POST-submit share step and attached to the
 * already-submitted claim via the `attachClaimStory` callable (see
 * V2ExperienceController.claimStoryDraft / flushClaimStory).
 */
export interface PrizeClaimForm {
  firstName: string;
  lastName: string;
  phone: string;
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
  /** JPEG base64 of the optional attached photo (already downscaled/capped). */
  photoBase64?: string;
  /**
   * The review screen's ONE remaining checkbox (2.9, team decision 14 Aug):
   * the likeness/promotion consent. OPTIONAL — it never gates SUBMIT; its
   * state travels to the backend as `promoConsentGranted`. Starts UNCHECKED:
   * consent must be an affirmative act (same stance as the capture screen's
   * marketing checkbox — pre-ticked boxes are invalid under GDPR).
   *
   * The former "information is accurate" and "agree to Official Rules"
   * checkboxes were REMOVED (the rules/privacy links remain as plain links).
   */
  authorizesLikeness: boolean;
}

/** Fixed — US-only sweepstakes. */
export const CLAIM_COUNTRY = 'United States';

/**
 * The review screen's optional likeness-consent copy (2.9.4, Joe's updated
 * frames): names the ACTUAL app/publisher when known so the consent reads as
 * a real grant ("I authorize Rumble and its promotional partners…"), falling
 * back to the generic "this app's publisher" only when no name is available.
 *
 * `name` resolution lives on the controller ({@link publisherName} =
 * server-fed `sdkConfig.appName`, else the host page's `document.title` —
 * the same source the winner share line uses).
 */
export function likenessConsentText(name?: string | null): string {
  const who = name?.trim() || "this app's publisher";
  return (
    `I authorize ${who} and its promotional partners to use my name, city, ` +
    'profile photo, and likeness for winner announcements and promotional ' +
    'purposes. (Optional)'
  );
}

export function emptyClaimForm(): PrizeClaimForm {
  return {
    firstName: '',
    lastName: '',
    phone: '',
    street: '',
    apt: '',
    city: '',
    state: '',
    zip: '',
    // Unchecked by default — optional consent must be an affirmative act.
    authorizesLikeness: false,
  };
}

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim());
}

/**
 * First/last name: non-empty after trim, at most 50 characters, and only
 * letters (any script, combining marks included), spaces, apostrophes,
 * hyphens, and periods — per the Master Field List validation rule.
 */
export function isValidClaimName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > 50) return false;
  return /^[\p{L}\p{M}\s.'’-]+$/u.test(trimmed);
}

/**
 * Optional phone: empty is fine; otherwise must strip to a 10-digit US number
 * (a leading 1 / +1 is tolerated), mirroring the backend's validatePhone.
 */
export function isValidClaimPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (trimmed === '') return true;
  const digits = trimmed.replace(/\D/g, '');
  return /^1?\d{10}$/.test(digits);
}

// Per-step validity (stepped flow)

/**
 * Step 1 "TELL US ABOUT YOURSELF": valid first + last name (email is
 * server-side); the optional phone must be empty or a valid US number.
 */
export function isStep1Valid(form: PrizeClaimForm): boolean {
  return (
    isValidClaimName(form.firstName) &&
    isValidClaimName(form.lastName) &&
    isValidClaimPhone(form.phone)
  );
}

/** Step 2 "WHERE SHOULD WE SEND YOUR PRIZE?": full US shipping address. */
export function isStep2Valid(form: PrizeClaimForm): boolean {
  return (
    form.street.trim() !== '' &&
    form.city.trim() !== '' &&
    form.state.trim() !== '' &&
    isValidZip(form.zip)
  );
}

// Step 3 (photo) and the post-submit share step are fully optional.

/**
 * SUBMIT enables when every required field across the steps is present and
 * the zip is a 5-digit US code. Phone, apartment, photo, and the likeness
 * consent are all optional — the review checkbox never gates SUBMIT (2.9):
 * its state is simply reported as `promoConsentGranted`.
 */
export function isClaimFormValid(form: PrizeClaimForm): boolean {
  return isStep1Valid(form) && isStep2Valid(form);
}

/** "First L." — the public display name on the winner card. */
export function claimDisplayName(form: PrizeClaimForm): string {
  const first = form.firstName.trim();
  const lastInitial = form.lastName.trim().charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/** 50 states + DC — accepted by the backend's US-state normalization. */
export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const;

// ─── Date helper ───

/**
 * "AUGUST, 2026" from an ISO date string (falls back to `now`) — the winner
 * card's award line. Mirrors iOS WINRClaimDates.monthYearDisplay.
 */
export function monthYearDisplay(iso?: string | null, now: Date = new Date()): string {
  let date: Date | null = null;
  if (iso) {
    // Full ISO timestamps parse directly; a bare "yyyy-MM-dd" must be pinned
    // to local time (the Date constructor would treat it as UTC midnight).
    const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (dayOnly) {
      date = new Date(
        parseInt(dayOnly[1]!, 10),
        parseInt(dayOnly[2]!, 10) - 1,
        parseInt(dayOnly[3]!, 10)
      );
    } else {
      const parsed = new Date(iso);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
  }
  const d = date ?? now;
  const months = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];
  return `${months[d.getMonth()]}, ${d.getFullYear()}`;
}

// ─── Photo downscale (canvas) ───

/** 5MB decoded cap — matches the backend's MAX_PHOTO_BYTES. */
export const CLAIM_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Decoded byte length of a raw base64 string (no data-URI prefix). */
export function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Downscales an image file so the long edge is ≤1200px, then JPEG-encodes,
 * stepping the quality down from 0.85 until the payload fits the 5MB cap.
 * Resolves with the raw base64 (no data-URI prefix), or null when the image
 * can't be decoded/encoded under the cap. Mirrors iOS WINRClaimPhoto.
 */
export async function claimPhotoBase64Jpeg(file: File | Blob): Promise<string | null> {
  const image = await loadImage(file);
  if (!image) return null;

  const { width, height } = image;
  const longest = Math.max(width, height);
  const scale = longest > 1200 ? 1200 / longest : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no alpha — flatten onto white like UIGraphicsImageRenderer does.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(image, 0, 0, targetW, targetH);
  if ('close' in image && typeof image.close === 'function') image.close();

  let quality = 0.85;
  let base64 = encodeJpegBase64(canvas, quality);
  while (base64 && base64ByteLength(base64) > CLAIM_PHOTO_MAX_BYTES && quality > 0.25) {
    quality -= 0.15;
    base64 = encodeJpegBase64(canvas, quality);
  }
  if (!base64 || base64ByteLength(base64) > CLAIM_PHOTO_MAX_BYTES) return null;
  return base64;
}

function encodeJpegBase64(canvas: HTMLCanvasElement, quality: number): string | null {
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:image/jpeg') || comma < 0) return null;
    return dataUrl.slice(comma + 1);
  } catch {
    return null;
  }
}

type DecodedImage = HTMLImageElement | ImageBitmap;

async function loadImage(file: File | Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> decoding */
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
