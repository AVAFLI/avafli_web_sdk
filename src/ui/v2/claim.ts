/**
 * Winner prize-claim flow helpers — ported from iOS WINRV2Claim.swift
 * (form model + validation, photo downscale, "MONTH, YYYY" date display).
 * Kept free of DOM rendering so validation is unit-testable.
 */

// ─── Form model + validation ───

/** The claim form's field values. */
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
}

/** Fixed — US-only sweepstakes. */
export const CLAIM_COUNTRY = 'United States';

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
  };
}

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim());
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

/**
 * SUBMIT enables when every required field is present, the zip is a 5-digit US
 * code, and the (optional) phone is empty or a valid US number. Apartment and
 * photo are optional.
 */
export function isClaimFormValid(form: PrizeClaimForm): boolean {
  return (
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    form.street.trim() !== '' &&
    form.city.trim() !== '' &&
    form.state.trim() !== '' &&
    isValidZip(form.zip) &&
    isValidClaimPhone(form.phone)
  );
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

/**
 * The three required consent confirmations on the claim form. The backend
 * stores consent as implied-on-submit (consentTextVersion "prize-claim-v1");
 * the form requires each box to be checked before SUBMIT enables.
 */
export const CLAIM_CONSENTS = [
  'I confirm the information provided is accurate and that I am the entrant associated with the winning entry.',
  'I confirm I am a resident of the United States and at least 18 years of age.',
  'I agree that my first name, last initial, city, and state (and photo, if provided) may be used to announce me as a winner, per the Official Rules & Privacy Policy.',
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
