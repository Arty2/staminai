# Changelog

All notable changes to staminai are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- **Claude Design ring and tooltip row.** Claude Design no longer has its own weekly allowance; its activity counts toward the plan's shared limits. The dotted outer ring is kept in the code, switched off (`OUTER_ENABLED`), for a future separate meter or a credit balance.

### Changed
- **Tooltip palette** fixed to Claude's dark popover colours: background `#20201f`, border `#373736`, text `#f0efeb`.
- **Organization name** in the tooltip drops the trailing "'s Organization" and is drawn in the border colour.
- **Countdown clock** is smaller, with more clearance from the wheel edge.

### Fixed
- **Refresh spinner** spun about the SVG's top-left corner instead of the wheel centre, and orbited outside the wheel. It now pivots on the centre and sits just inside the rim with a thinner stroke.

## [2.3.0] — 2026-09-16

### Added
- **Dormant Credits row.** A tooltip row for a credit balance is wired up but switched off — the usage endpoint does not surface one, and nothing reads the response for it. Nothing changes on screen; the row exists so it can be enabled the day the field appears.
- **Exhausted-state countdown.** When the session or weekly limit is fully spent, the rings give way to an `HH:MM` countdown to the reset — at that point the only number worth showing. It repaints every 30 s (no network, skipped while the tab is backgrounded) and stands itself down the moment the wheel returns to rings.

### Changed
- **No number inside the inner ring.** Exact percentages live in the tooltip; the rings are the whole reading. This also removes the backing disc that was clipping the session arc's round end cap.
- **Ring proportions rebalanced** so the session arc tapers to a true round tip whose diameter matches the ring thickness. The cap has radius `S_SESSION / 2`, so the layout now lands the ring radius exactly on `S_SESSION` — any thicker and the cap overran the centre hole and curled the arc over itself. Gaps widened from 3 to 4 so the rings read as three distinct bands.

### Fixed
- **Design ring progress now actually shows proportion.** The dotted ring was drawing progress as a `stroke-dashoffset` on its own dash pattern, which only slid the dots around — the colour never retracted. It's now a full dotted ring masked by a plain arc, so the colour retracts around the ring exactly like the solid ones. The dot period divides the circumference evenly (no seam at the start point) and the mask is snapped to end in a gap so no dot is sliced in half.

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
