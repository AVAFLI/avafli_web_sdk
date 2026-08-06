/**
 * Browser perimeter token (reCAPTCHA Enterprise, score-based).
 *
 * On a phone the SDK has a hardware-backed identifier to lean on. In a browser it
 * has a text box, so a script can drive signup as fast as it likes. This mints a
 * risk-scored token that the backend grades.
 *
 * Three properties matter more than the scoring itself:
 *
 *  - It NEVER blocks the experience. Every failure path returns undefined and the
 *    request proceeds without a token; the backend decides what to do about that.
 *    A perimeter that can break the product it protects is not worth having, and a
 *    publisher whose CSP blocks Google should still get a working SDK.
 *  - It is invisible. Score-based reCAPTCHA shows no challenge and no badge
 *    interaction — the user never sees it, which is the point of putting it here
 *    rather than in front of the email form.
 *  - The script loads once, lazily, on first use. A publisher who never triggers a
 *    registration never pays for the network request.
 */

const SITE_KEY = '6Lc5NHgtAAAAAJT6dO3XqcOEL_dDXzO5GvVvC5L_';
const SCRIPT_ID = 'winr-recaptcha';
const BADGE_STYLE_ID = 'winr-recaptcha-badge';
const LOAD_TIMEOUT_MS = 4000;
const EXECUTE_TIMEOUT_MS = 4000;

interface GreCaptcha {
  enterprise: {
    ready(cb: () => void): void;
    execute(siteKey: string, opts: { action: string }): Promise<string>;
  };
}

declare global {
  interface Window { grecaptcha?: GreCaptcha }
}

let loadPromise: Promise<boolean> | null = null;

/** Resolve `false` rather than reject — a missing perimeter is not an error here. */
function loadScript(): Promise<boolean> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if (window.grecaptcha?.enterprise) {
      resolve(true);
      return;
    }

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    // Hide the floating reCAPTCHA badge.
    //
    // Score-based reCAPTCHA never challenges anyone — no puzzle, no interruption —
    // but it does inject a fixed-position Google badge into the corner of the host
    // page. Inside a publisher's app that is an uninvited third-party overlay they
    // did not ask for, and it can sit on top of their own UI.
    //
    // Google permits hiding it PROVIDED the attribution appears in the flow instead,
    // which renderLegalLinks() now does on the capture screen. That is the trade:
    // the badge goes, the required notice stays visible.
    if (!document.getElementById(BADGE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = BADGE_STYLE_ID;
      style.textContent = '.grecaptcha-badge{visibility:hidden!important}';
      document.head.appendChild(style);
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}`;
    script.async = true;
    script.defer = true;

    // A publisher's Content-Security-Policy may forbid this origin outright. That
    // is their call to make, and it must degrade to "no token", never to a broken
    // SDK — hence the timeout as well as the error handler.
    const timer = setTimeout(() => resolve(false), LOAD_TIMEOUT_MS);
    script.onload = () => { clearTimeout(timer); resolve(true); };
    script.onerror = () => { clearTimeout(timer); resolve(false); };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Mint a token for `action`, or undefined if the perimeter is unavailable.
 *
 * The action is bound into the token so the backend can reject one harvested from
 * a low-value page and replayed against signup.
 */
export async function getPerimeterToken(action: string): Promise<string | undefined> {
  try {
    if (!(await loadScript())) return undefined;
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha?.enterprise) return undefined;

    return await new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), EXECUTE_TIMEOUT_MS);
      grecaptcha.enterprise.ready(() => {
        grecaptcha.enterprise
          .execute(SITE_KEY, { action })
          .then((t) => { clearTimeout(timer); resolve(t); })
          .catch(() => { clearTimeout(timer); resolve(undefined); });
      });
    });
  } catch {
    return undefined;
  }
}
