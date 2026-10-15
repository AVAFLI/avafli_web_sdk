/**
 * Lazy loader for the drawer UI (3.2.1).
 *
 * The ESM build splits src/ui/v2/** into its own chunk; this is the only
 * place the boot chunk reaches it, through a dynamic `import()` that runs on
 * the first open (auto-open, `Avafli.present()`, or a pending-claim reopen).
 * The UMD build inlines the chunk (rollup `inlineDynamicImports`) so the
 * script-tag bundle stays one file — the import() resolves on the next tick.
 *
 * One in-flight promise is shared; a failed load (offline, blocked CDN) is
 * forgotten so the next open retries instead of replaying the rejection.
 */
export type ExperienceModule = typeof import('./ui/v2/ui');

let pending: Promise<ExperienceModule> | null = null;

export function loadExperienceModule(): Promise<ExperienceModule> {
  if (!pending) {
    pending = import('./ui/v2/ui').catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

/** @internal — test hook; drops the cached module promise. */
export function resetExperienceLoader(): void {
  pending = null;
}
