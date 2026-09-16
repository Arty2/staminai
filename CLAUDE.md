# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`staminai` is a **zero-dependency, zero-build browser extension** that draws a
usage wheel on `claude.ai`. It ships as an MV3 extension (Firefox + Chromium)
and as a Greasemonkey userscript, all from the same two source files.

There is no npm, no bundler, no transpiler, and no test runner. `content.js`
and `content.css` are shipped byte-for-byte as authored. Keep it that way —
the "~200 lines JS, ~80 lines CSS, fully auditable" claim in the README is a
feature, and every added dependency is one more thing a store reviewer has to
vet.

## Layout

```
manifest.json   MV3 manifest, shared by Firefox and Chromium. Sole source of the version number.
content.js      Everything: rendering, placement, drag, API access, backoff.
content.css     Styling. Uses Claude's own CSS custom properties with fallbacks.
icons/          16/32/48/128 PNGs (referenced by the manifest) + the SVG master.
build.sh        Packages the three artifacts. Pure bash + zip + awk.
.github/workflows/build.yml   Builds and releases on a `v*` tag push.
```

## Commands

```bash
./build.sh            # all three artifacts into dist/
./build.sh firefox    # dist/staminai-firefox.xpi
./build.sh chromium   # dist/staminai-chromium.zip
./build.sh userscript # dist/staminai.user.js
./build.sh clean      # rm -rf dist/

node --check content.js                  # the only "lint" that always works
python3 -c 'import json; json.load(open("manifest.json"))'
node --check dist/staminai.user.js        # catches CSS→JS-string escaping bugs
npx web-ext lint                          # AMO's own linter, if network is available
```

### Build system notes

- **Version lives only in `manifest.json`.** `read_version()` scrapes it with
  `grep`/`sed` (no `jq` dependency) and the userscript header interpolates it.
  When bumping, also add a `CHANGELOG.md` entry — nothing enforces this.
- **`preflight()` runs before every build.** It fails fast if a source file or
  a manifest-referenced icon is missing, because AMO and the Chrome Web Store
  reject those uploads only *after* you've waited in the review queue.
- **The `.xpi` and the `.zip` have identical contents.** Only the extension
  differs; Firefox just wants `.xpi`. Don't "optimize" this into one artifact —
  the two file names are what the release workflow and the README point at.
- **`to_js_string()` embeds `content.css` into the userscript** as a
  double-quoted JS string literal, escaping backslashes, double quotes and
  newlines. If you ever put a backtick, `${`, or a `</script` sequence in the
  CSS, re-run `node --check dist/staminai.user.js` before trusting it.
- **CI only fires on `v*` tags.** There is no PR/push validation job. If you
  change `build.sh`, run it locally — CI will not catch a break until release.

## Architecture

- **Single IIFE, no globals.** `content.js` is one `(function () { "use strict"; ... })()`.
- **Fixed SVG coordinate space.** The wheel's SVG has a constant `viewBox="0 0 100 100"`
  and is sized purely by CSS (`--csw-size`). Every radius, stroke width and font
  size in the JS is therefore a *percentage of the wheel* — never a pixel value.
  Changing the widget's size is a one-line CSS change; never reach for JS to
  resize the SVG.
- **Two scale knobs, both in `content.css`:** `--csw-size` (the wheel) and
  `--csw-font` (the tooltip). Everything in the tooltip is expressed in `em`, so
  it follows `--csw-font`. Don't reintroduce fixed `px` font sizes.
- **The widget floats free.** It is positioned in viewport pixels and anchored
  to nothing in Claude's DOM, so a Claude UI change can't strand it. The
  position is stored as a *fraction* of the free space (`{fx, fy}` in
  `localStorage`) so it survives resizes and restores sensibly on a different
  screen. Every write is wrapped in `try/catch` — `localStorage` throws in some
  private-browsing modes.
- **Event-driven, never polling.** No `MutationObserver`, and nothing on a timer
  fetches. Refreshes come from page load, wheel hover, and document-delegated
  `focusin`/`click` on the chatbox — debounced 3 s and skipped when the tab is
  backgrounded. The one `setInterval` in the codebase (`setTick`) repaints the
  exhausted-state countdown, makes no network calls, is skipped while the tab is
  backgrounded, and clears itself the moment the wheel returns to rings. Don't
  add a second timer.
- **Backoff is mandatory.** 429 climbs a 1/5/15-minute ladder; 5xx waits 30 s;
  `Retry-After` wins when it asks for longer. Never add a code path that hits
  `/api/organizations/*` without going through `triggerRefresh()`.
- **Drag vs. click.** Pointer Events with `setPointerCapture`; movement under
  `DRAG_SLOP` px stays a click. `suppressClick` swallows the synthetic click
  that follows a real drag and is cleared on the next `pointerdown` so it can
  never go stale.
- **The wheel carries no text in its normal state.** Exact numbers live in the
  tooltip; the rings are the whole reading. The only text it ever shows is the
  exhausted-state countdown.

### Ring geometry

`rSession` must stay **at or below `S_SESSION`**. The session arc has a round
end cap of radius `S_SESSION / 2`, so once the stroke is thicker than the ring's
own radius the cap overruns the centre hole and the arc curls over itself into a
comma instead of tapering to a round tip. The current constants land `rSession`
exactly on `S_SESSION` — the thickest the inner ring can be. If you thicken it
further, widen `GAP` or thin the outer rings to compensate, and re-render the
`full` / `mixed` / `critical` states before believing it looks right.

The **design ring is dotted, and a dotted ring cannot carry progress in its own
dash pattern** — putting a `stroke-dashoffset` on it just slides the dots around
and shows no proportion at all. It is drawn as a full dotted ring masked by a
plain arc, so the colour retracts around the ring exactly like the solid ones.
The dot period is derived as `circumference / DESIGN_DOTS` so the pattern closes
with no seam at the 3 o'clock start, and the mask arc is snapped to end in a gap
so no dot is ever sliced in half.

### Tolerating an unknown API shape

`getDesignUtil` and `getCredits` both probe a list of candidate field names and
return `null` when none match, because the usage endpoint is undocumented and
has carried these under different keys. Callers render the Design row as `—` and
omit the Credits row entirely when the lookup comes back empty. Keep new fields
defensive in the same way — never index straight into a response.

## Best practices for browser add-ons

These are the rules this extension is held to. Apply them to any change here,
and to any other add-on work in this repo.

### Manifest and permissions

- **MV3 only.** MV2 is dead in Chrome and deprecated in Firefox.
- **Ask for the narrowest possible match.** `https://claude.ai/*` in
  `content_scripts.matches` is all this needs. Never add `<all_urls>`, and never
  add a permission "in case we need it later" — each one is a review delay and a
  scarier install prompt.
- **Prefer no `permissions` block at all.** Same-origin `fetch` with
  `credentials: "include"` from a content script reuses the user's session and
  needs neither `cookies` nor `host_permissions`. That's why this extension's
  permission table is one row long.
- **Keep Firefox-specific keys in `browser_specific_settings.gecko`.** Chromium
  ignores the block, so one manifest serves both. `gecko.id` and
  `strict_min_version` are required for AMO; `data_collection_permissions` is
  now required for all new AMO submissions — `{"required": ["none"]}` when the
  add-on transmits nothing.
- **Bump `version` for every submission.** Stores reject a re-upload of an
  existing version, and there is no way to overwrite one.

### Security

- **Never assign untrusted data to `innerHTML`.** Build DOM with
  `createElement`/`createElementNS` and set text via `textContent`. A static
  template literal with no interpolation (like this extension's one `root.innerHTML`
  skeleton) is fine; anything carrying API or user data is not. AMO's linter
  flags these and they are the most common cause of a rejected review.
- **No remote code, ever.** No `eval`, no `new Function`, no CDN `<script>`, no
  `fetch`-then-execute. Stores reject it outright; bundle everything.
- **Treat every API response as hostile.** Optional-chain into it, clamp numbers
  into range, and render values as text.
- **Don't leak the page's data.** Content scripts run in an isolated world but
  share the DOM. Never send anything off-origin, and never log secrets.

### Interoperability

- **Use the `browser.*`/`chrome.*` APIs only when you actually need them.** This
  extension needs neither: a content script plus DOM APIs is portable to
  Firefox, Chromium *and* a userscript with zero shims. Reach for extension APIs
  last, since they're what forks the codebase.
- **Assume the host page's DOM will change without notice.** Claude is a
  shipping SPA. Prefer semantic or `data-testid` hooks with partial matches,
  degrade gracefully when a hook disappears, and — as here — avoid depending on
  host elements for layout at all.
- **Namespace everything.** Every id and class is prefixed `csw-`, and the root
  sits at `z-index: 2147483646`. An unprefixed class name will collide with the
  host page eventually.
- **Inherit the host's theme.** Read the page's CSS custom properties
  (`--bg-100`, `--text-200`, …) with sane fallbacks rather than hard-coding
  colors — the widget then tracks Claude's theme for free.

### UX

- **Never block or cover the host UI.** Stay out of the way, keep the footprint
  small, and let the user move it.
- **Persist only user preferences, locally.** Widget position is fine;
  anything about the user's content is not.
- **Fail quietly and visibly.** Show a degraded state (here: the red error
  ring), log a `console.warn` with a `[staminai]` prefix, and keep rendering.
  Never throw into the host page.
- **Respect rate limits.** Debounce, back off, and skip work in background tabs.

### Testing

There is no test runner, so verify changes by driving a real browser. Chromium
is available at `/opt/pw-browsers/chromium`; `playwright-core` drives it. The
pattern that works: serve the repo over `python3 -m http.server`, load a small
HTML page that links `content.css`, stubs `window.fetch` with a fake
`/usage` payload, and then loads `content.js`. That exercises rendering,
placement, drag, clamping and persistence without needing a Claude session.
Keep scratch test files out of the repo.
