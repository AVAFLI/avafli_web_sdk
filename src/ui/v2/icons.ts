/**
 * Inline SVG icons for the V2 experience — extracted from Joe's Figma
 * (same sources as the iOS SDK's template PNG/SVG assets). All fills use
 * `currentColor` so the surrounding CSS `color` tints them (accent/white),
 * matching iOS's `.foregroundColor(...)` template rendering.
 */

const svg = (viewBox: string, body: string): string =>
  `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" ` +
  `style="display:block;width:100%;height:100%">${body}</svg>`;

/** Flame (streak) — iOS "winr-flame". */
export const flameIcon = svg(
  '0 0 15.9963 20.5049',
  '<path d="M15.48 10.854C13.91 6.77405 8.32 6.55405 9.67 0.624047C9.77 0.184047 9.3 -0.155953 8.92 0.0740467C5.29 2.21405 2.68 6.50405 4.87 12.124C5.05 12.584 4.51 13.014 4.12 12.714C2.31 11.344 2.12 9.37405 2.28 7.96405C2.34 7.44405 1.66 7.19405 1.37 7.62405C0.69 8.66405 0 10.344 0 12.874C0.38 18.474 5.11 20.194 6.81 20.414C9.24 20.724 11.87 20.274 13.76 18.544C15.84 16.614 16.6 13.534 15.48 10.854ZM6.2 15.884C7.64 15.534 8.38 14.494 8.58 13.574C8.91 12.144 7.62 10.744 8.49 8.48405C8.82 10.354 11.76 11.524 11.76 13.564C11.84 16.094 9.1 18.264 6.2 15.884Z" fill="currentColor"/>'
);

/** Entry ticket — iOS "winr-ticket". */
export const ticketIcon = svg(
  '0 0 19.9 12.6',
  '<path d="M19.9 4.7V1.6C19.9 0.7 19.2 0 18.3 0H1.6C0.7 0 0 0.7 0 1.6V4.7C0.9 4.7 1.6 5.4 1.6 6.3C1.6 7.2 0.9 7.9 0 7.9V11C0 11.9 0.7 12.6 1.6 12.6H18.3C19.2 12.6 19.9 11.9 19.9 11V7.9C19 7.9 18.3 7.2 18.3 6.3C18.3 5.4 19 4.7 19.9 4.7ZM12.2 9.4L9.9 7.9L7.6 9.4L8.3 6.8L6.2 5.1L8.9 4.9L9.9 2.4L10.9 4.9L13.6 5.1L11.5 6.8L12.2 9.4Z" fill="currentColor"/>'
);

/** Padlock (locked streak tile) — iOS "winr-lock". */
export const lockIcon = svg(
  '0 0 16 21.0028',
  '<path d="M16 7.00276H13V5.21276C13 2.60276 11.09 0.272764 8.49 0.0227641C5.51 -0.257236 3 2.08276 3 5.00276V7.00276H0V21.0028H16V7.00276ZM8 16.0028C6.9 16.0028 6 15.1028 6 14.0028C6 12.9028 6.9 12.0028 8 12.0028C9.1 12.0028 10 12.9028 10 14.0028C10 15.1028 9.1 16.0028 8 16.0028ZM5 7.00276V5.00276C5 3.34276 6.34 2.00276 8 2.00276C9.66 2.00276 11 3.34276 11 5.00276V7.00276H5Z" fill="currentColor"/>'
);

/** Envelope (email field) — iOS "winr-mail". */
export const mailIcon = svg(
  '0 0 20 16',
  '<path d="M18 0H2C0.9 0 0 0.9 0 2V14C0 15.1 0.9 16 2 16H18C19.1 16 20 15.1 20 14V2C20 0.9 19.1 0 18 0ZM17.6 4.25L11.06 8.34C10.41 8.75 9.59 8.75 8.94 8.34L2.4 4.25C2.15 4.09 2 3.82 2 3.53C2 2.86 2.73 2.46 3.3 2.81L10 7L16.7 2.81C17.27 2.46 18 2.86 18 3.53C18 3.82 17.85 4.09 17.6 4.25Z" fill="currentColor"/>'
);

/** Calendar (come-back bar) — iOS "winr-calendar". */
export const calendarIcon = svg(
  '0 0 25.6142 28.1756',
  '<path d="M25.6142 2.56142H21.7721V0H19.2107V2.56142H6.40355V0H3.84213V2.56142H0V28.1756H25.6142V2.56142ZM23.0528 25.6142H2.56142V8.96498H23.0528V25.6142Z" fill="currentColor"/>'
);

/** Close X — iOS "winr-close". */
export const closeIcon = svg(
  '0 0 10.1884 10.1884',
  '<path d="M9.96239 0.23375C9.66102 -0.0676135 9.1742 -0.0676135 8.87284 0.23375L5.0942 4.00466L1.31557 0.226023C1.0142 -0.0753409 0.527386 -0.0753409 0.226023 0.226023C-0.0753409 0.527386 -0.0753409 1.0142 0.226023 1.31557L4.00466 5.0942L0.226023 8.87284C-0.0753409 9.1742 -0.0753409 9.66102 0.226023 9.96239C0.527386 10.2637 1.0142 10.2637 1.31557 9.96239L5.0942 6.18375L8.87284 9.96239C9.1742 10.2637 9.66102 10.2637 9.96239 9.96239C10.2637 9.66102 10.2637 9.1742 9.96239 8.87284L6.18375 5.0942L9.96239 1.31557C10.256 1.02193 10.256 0.527387 9.96239 0.23375Z" fill="currentColor"/>'
);

/** Small dropdown arrow under the "DAILY PROGRESS" pointer — iOS "winr-arrow-down". */
export const arrowDownIcon = svg(
  '0 0 7.18049 4.5925',
  '<path d="M0.296477 1.71L2.88648 4.3C3.27648 4.69 3.90648 4.69 4.29648 4.3L6.88648 1.71C7.51648 1.08 7.06648 0 6.17648 0H0.996477C0.106477 0 -0.333523 1.08 0.296477 1.71Z" fill="currentColor"/>'
);

/** Plus (winner banner trailing button). */
export const plusIcon = svg(
  '0 0 18.5455 18.5455',
  '<path d="M16.152 9.27816C16.152 8.85196 15.8077 8.50773 15.3815 8.50773L10.0432 8.50227L10.0432 3.15847C10.0432 2.73228 9.69896 2.38804 9.27277 2.38804C8.84658 2.38804 8.50234 2.73228 8.50234 3.15847L8.50235 8.50227L3.15855 8.50227C2.73235 8.50227 2.38812 8.8465 2.38812 9.27269C2.38812 9.69888 2.73235 10.0431 3.15855 10.0431L8.50235 10.0431L8.50235 15.3869C8.50235 15.8131 8.84658 16.1573 9.27277 16.1573C9.69896 16.1573 10.0432 15.8131 10.0432 15.3869L10.0432 10.0431L15.387 10.0431C15.8023 10.0431 16.152 9.69342 16.152 9.27816Z" fill="currentColor"/>'
);

/** Back chevron (how-it-works header). */
export const chevronLeftIcon = svg(
  '0 0 10 16',
  '<path d="M8.5 1L2 8L8.5 15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
);

/** Half-filled shield (claim splash security card) — SF "shield.lefthalf.filled". */
export const shieldIcon = svg(
  '0 0 20 24',
  '<path d="M10 0L20 3.5V11C20 17.2 15.9 22.2 10 24C4.1 22.2 0 17.2 0 11V3.5L10 0Z" ' +
    'stroke="currentColor" stroke-width="1.6" fill="none"/>' +
    '<path d="M10 1.06L1 4.21V11C1 16.6 4.7 21.2 10 22.94V1.06Z" fill="currentColor"/>'
);

/** Paperclip (ATTACH A PHOTO button on the claim form). */
export const paperclipIcon = svg(
  '0 0 18 20',
  '<path d="M15.5 9.2L8.7 16A4.06 4.06 0 0 1 3 10.3L10.5 2.8A2.7 2.7 0 0 1 14.3 6.6L7.3 13.6A1.35 1.35 0 0 1 5.4 11.7L11.6 5.5" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
);

/** Share-out arrow (UPLOAD PHOTO) — SF "square.and.arrow.up". */
export const uploadIcon = svg(
  '0 0 20 24',
  '<path d="M6 8H3.5V22.5H16.5V8H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '<path d="M10 1.5V14.5M10 1.5L5.8 5.7M10 1.5L14.2 5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
);

/** Filled camera (TAKE PHOTO + the step-3 avatar badge) — SF "camera.fill".
    The lens is punched out (evenodd) so the surface color shows through. */
export const cameraIcon = svg(
  '0 0 24 19',
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.2 0.8A1.6 1.6 0 0 1 9.5 0h5a1.6 1.6 0 0 1 1.3 0.8L17 2.6h4.4A2.6 2.6 0 0 1 24 5.2v11.2a2.6 2.6 0 0 1-2.6 2.6H2.6A2.6 2.6 0 0 1 0 16.4V5.2a2.6 2.6 0 0 1 2.6-2.6H7L8.2 0.8ZM12 15A4.4 4.4 0 1 0 12 6.2A4.4 4.4 0 0 0 12 15Z" fill="currentColor"/>'
);

/** Head-and-shoulders placeholder (empty step-3 avatar) — SF "person.fill". */
export const personIcon = svg(
  '0 0 24 24',
  '<circle cx="12" cy="7.2" r="5.2" fill="currentColor"/>' +
    '<path d="M2 22.5C2 17.5 6.4 14.3 12 14.3C17.6 14.3 22 17.5 22 22.5H2Z" fill="currentColor"/>'
);

// ─── Step-4 social glyphs (simple white marks, no third-party brand assets) ───

export const socialInstagramIcon = svg(
  '0 0 48 48',
  '<rect x="6" y="6" width="36" height="36" rx="11" stroke="currentColor" stroke-width="3.2" fill="none"/>' +
    '<circle cx="24" cy="24" r="8.4" stroke="currentColor" stroke-width="3.2" fill="none"/>' +
    '<circle cx="34.6" cy="13.4" r="2.4" fill="currentColor"/>'
);

export const socialFacebookIcon = svg(
  '0 0 48 48',
  '<path d="M24 2A22 22 0 1 0 24 46A22 22 0 1 0 24 2ZM30.6 15.5H27.8C26.6 15.5 26.2 16.2 26.2 17.4V20.3H30.4L29.8 24.9H26.2V38H21.2V24.9H17.6V20.3H21.2V16.6C21.2 13 23.3 10.9 26.9 10.9C28.6 10.9 30 11 30.6 11.1V15.5Z" fill="currentColor"/>'
);

export const socialXIcon = svg(
  '0 0 48 48',
  '<path d="M28.6 20.5L44 3H40.3L27 18.2L16.4 3H4L20.2 26.2L4 44.6H7.7L21.8 28.5L33.1 44.6H45.5L28.6 20.5ZM23.7 26.4L22 24.1L9 5.7H14.6L25.2 20.7L26.8 23L40.4 42.1H34.8L23.7 26.4Z" fill="currentColor"/>'
);

export const socialSnapchatIcon = svg(
  '0 0 48 48',
  '<path d="M8.6 20.2C8.6 11.5 15.4 5.6 24 5.6C32.6 5.6 39.4 11.5 39.4 20.2V26.2C41 29.4 43.9 30.6 46 31.1C46 33 42.6 34.5 39.6 34.9C39.3 36 38.9 37.3 38.3 37.3C37.2 37.3 35.9 36.8 34 37.3C32.1 37.8 30.2 40.4 24 40.4C17.8 40.4 15.9 37.8 14 37.3C12.1 36.8 10.8 37.3 9.7 37.3C9.1 37.3 8.7 36 8.4 34.9C5.4 34.5 2 33 2 31.1C4.1 30.6 7 29.4 8.6 26.2V20.2Z" ' +
    'stroke="currentColor" stroke-width="3" stroke-linejoin="round" fill="none"/>'
);

export const socialTiktokIcon = svg(
  '0 0 48 48',
  '<path d="M31.8 4H25V32.2A5.9 5.9 0 1 1 19.1 26.3C19.7 26.3 20.3 26.4 20.9 26.6V19.6C20.3 19.5 19.7 19.5 19.1 19.5A12.8 12.8 0 1 0 31.9 32.3V16.3A16.2 16.2 0 0 0 41 19.1V12.2A9.3 9.3 0 0 1 31.8 4Z" fill="currentColor"/>'
);

/** Empty / checked checkbox squares (18+ consent). */
export const squareIcon = svg(
  '0 0 20 20',
  '<rect x="1.25" y="1.25" width="17.5" height="17.5" rx="2.5" stroke="currentColor" stroke-width="1.8"/>'
);

export const checkSquareIcon = svg(
  '0 0 20 20',
  '<rect x="0.5" y="0.5" width="19" height="19" rx="3" fill="currentColor"/>' +
  '<path d="M5 10.2L8.4 13.6L15 6.6" stroke="#1d2330" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
);
