/**
 * Ambient declaration for Font Awesome Pro's icon set, which IconField loads
 * lazily for its search grid.
 *
 * The package is a *paid, private-registry* dependency (npm.fontawesome.com,
 * token required) — it 404s on the public npm registry, so it is declared in
 * package.json as an optional dependency: a machine without a Font Awesome Pro
 * token still installs, and the compiler still needs the module name to mean
 * something. This shorthand types it as `any`, which is also all IconField
 * assumes — it walks the exports with `Object.values(mod as Record<string,
 * any>)` and duck-checks `def.icon` / `def.iconName`.
 *
 * On a machine where the real package IS installed this declaration shadows
 * its bundled types; that costs nothing today for the same reason.
 */
declare module '@fortawesome/pro-light-svg-icons';
