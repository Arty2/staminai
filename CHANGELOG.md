# Changelog

All notable changes to staminai are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] — 2026-09-15

### Added
- **Draggable wheel.** Hold and drag the wheel anywhere on screen. Movement under 4px still counts as a click, so the tooltip toggle is unaffected. The position is remembered in `localStorage` as a fraction of the viewport, so it survives reloads and restores proportionally on a different window size.
- **CLAUDE.md** — project guidance plus the browser-add-on practices this extension is held to.
- **`./build.sh clean`**, and a preflight check that fails the build early when a source file or a manifest-referenced icon is missing.

### Changed
- **The wheel no longer anchors to the avatar.** It floats free at the middle right of the viewport by default and is never attached to a Claude DOM node, so a Claude UI reshuffle can't strand it. `findAvatar`/`anchorToAvatar` are gone.
- **Everything scales with the viewport.** The wheel is `clamp(28px, 2vw, 56px)`; the SVG now lives in a fixed `0 0 100 100` viewBox and is sized purely by CSS, so every radius, stroke width and the center label scale with it. Tooltip text derives from a single `--csw-font` and is sized in `em` — no fixed `px` font sizes remain.
- **Thicker rings.** Session 14.6% → 20% of the wheel, weekly 7.3% → 11%, design 4.2% → 5%. The center reading now sits on a solid disc so it stays legible against the heavier session ring.
- **Weekly and Design resets show a weekday and clock time** ("Weekly resets Fri 11:48 PM") instead of an hour countdown, localized to the browser. The 5-hour session reset stays a countdown.
- **The tooltip picks its side**, flipping left or right depending on which half of the viewport the wheel sits in, and shifts vertically to stay on screen near the top and bottom edges.
- Zip artifacts exclude `.DS_Store` and `__MACOSX` junk.

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
