/**
 * Entry of the lazily loaded UI chunk (3.2.1). The boot chunk reaches the
 * drawer only through `import('./ui/v2/ui')` (see src/experience-loader.ts),
 * so everything under src/ui/v2 — screens, styles, controller, asset manifest
 * — stays out of the page until the drawer first opens. The UMD build inlines
 * this chunk and stays a single file.
 */
export { AvafliV2Experience } from './root';
export { V2ExperienceController } from './controller';
