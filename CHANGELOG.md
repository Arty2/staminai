# Changelog

All notable changes to staminai are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] — 2026-04-19

### Fixed
- **Firefox addon validation.** Added the `data_collection_permissions` key (`"required": ["none"]`) to `browser_specific_settings.gecko` — now required by AMO for all new submissions. The wheel renders the user's own usage numbers; it transmits nothing back.
- **No more `innerHTML` on dynamic content.** `renderWheel` now builds the SVG with `createElementNS`, and `renderTip` builds the tooltip with `createElement` + `textContent`. Resolves two "Unsafe assignment to innerHTML" linter warnings in `content.js` and removes the need for the `escapeHtml` helper.
- **Wheel size clamp.** The wheel now never exceeds the avatar it's anchored to, and has a minimum size of 20px.

## [2.1.0] — 2026-04-19

### Added
- **Active org detection.** The extension now reads the `lastActiveOrg` cookie and matches it against `/api/organizations` to pick the organization you're currently viewing, instead of blindly using the first entry.
- **Org name in tooltip.** The tooltip header now shows the name of the currently active organization.
- **Re-resolve on workspace switch.** When the active-org cookie changes between refreshes, the cached org is invalidated and the wheel re-fetches.
- **Error backoff.** HTTP 429 responses now trigger a 1 min → 5 min → 15 min cooldown ladder. 5xx responses trigger a 30 s cooldown. The `Retry-After` header is honored when present and overrides the ladder if longer.
- **Greasemonkey / Tampermonkey userscript artifact.** `./build.sh userscript` (or `./build.sh all`) now produces `dist/staminai.user.js`. Drop it into any userscript manager — no `@grant` permissions required.
- **CHANGELOG.md.**

### Changed
- **Avatar anchor uses `button[data-testid*="user-menu-button"]`** with a partial attribute match. The previous multi-selector fallback array and the heuristic scan of circular buttons near the bottom of `<nav>` / `<aside>` have been removed.
- **Refresh triggers are now purely event-driven.** The 2-second `setInterval` anchor-poll has been removed, as has the `MutationObserver` that re-bound the chatbox on DOM churn. The extension now relies on:
  - page load
  - wheel hover
  - chatbox `focusin` (document-delegated)
  - chatbox `click` (document-delegated)
  - `window.resize` (for re-anchoring only)
- **Refreshes skip when the tab is backgrounded.** Debounced refreshes bail out if `document.visibilityState !== "visible"`.

### Fixed
- Tooltip org name is HTML-escaped before rendering.

## [2.0.0]

Initial public release.
