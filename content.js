/* ── staminai · content.js ─── v2.3 ─────────────────
 *  The AI token stamina wheel for Claude
 *  Dialectic Acheropoieton of Heracles Papatheodorou and Claude
 *  MIT License · https://heracl.es/staminai
 * ──────────────────────────────────────────────────── */

(function () {
  "use strict";

  const FADE_MS = 4000, DEBOUNCE_MS = 3000;

  /* The SVG lives in a fixed 100×100 coordinate space and is scaled by CSS
   * (--csw-size). Every stroke width, radius and font size below is therefore
   * a percentage of the wheel, so the whole widget scales with the viewport. */
  const VB = 100;

  /* Ring geometry. The layout below lands rSession exactly on S_SESSION, which
   * is the constraint that matters: the round end cap has radius S_SESSION / 2,
   * so any thicker and the cap overruns the centre hole and the arc curls over
   * itself instead of tapering to a round tip. */
  const S_SESSION = 15;              // inner ring
  const S_WEEKLY  = 12;              // middle ring
  const S_DESIGN  = 6;               // outer ring (Claude Design)
  const GAP       = 4;
  const RIM       = 1.5;             // breathing room at the wheel edge

  const DESIGN_DOTS = 16;            // dots around the design ring
  const DESIGN_DUTY = 0.42;          // fraction of each dot period that is ink
  const CLOCK_FS    = 32;            // countdown type size, in viewBox units
  const TICK_MS     = 30_000;        // countdown repaint cadence (no network)

  const EDGE_PAD = 8;                // keep this far from the viewport edge
  const DRAG_SLOP = 4;               // px of movement before a click becomes a drag
  const POS_KEY = "staminai:pos";

  const TRACK       = "rgba(255,255,255,0.07)";
  const REFRESH_CLR = "rgba(255,255,255,0.22)";

  // Backoff ladder for HTTP 429, in ms
  const BACKOFF_429 = [60_000, 300_000, 900_000];
  const BACKOFF_5XX = 30_000;

  const palette = (pct) => {
    const r = 100 - pct;
    if (r > 50) return { stroke: "#5ec269" };
    if (r > 25) return { stroke: "#e8c840" };
    if (r > 10) return { stroke: "#e87040" };
    return              { stroke: "#e84060" };
  };

  let orgId = null, orgName = null, data = null, expanded = false;
  let fadeTimer = null, lastRefresh = 0;
  let cooldownUntil = 0, retry429Step = 0;
  let frac = { fx: 1, fy: 0.5 };     // normalized position, default: middle right
  let suppressClick = false;
  let blockedEnd = null, tickTimer = null;

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  const root = document.createElement("div");
  root.id = "csw-root";
  root.innerHTML = `
    <div id="csw-tip"></div>
    <div id="csw-wheel">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}"></svg>
    </div>`;

  /* ── Extract design data from API response ─────────── */

  function getDesignUtil(raw) {
    const d = raw?.seven_day_design
           || raw?.design
           || raw?.seven_day_opus
           || null;
    if (!d || d.utilization == null) return null;
    return {
      utilization: Math.min(d.utilization, 100),
      resets_at: d.resets_at || null
    };
  }

  /* ── Extract credit balance from API response ──────── */

  /* The usage endpoint has carried this under several names; accept a bare
   * number or an object, and render nothing at all when none of them match. */
  function getCredits(raw) {
    if (!raw || typeof raw !== "object") return null;
    const num = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (v && typeof v === "object") {
        for (const k of ["available", "remaining", "balance", "amount", "credits"]) {
          if (typeof v[k] === "number" && Number.isFinite(v[k])) return v[k];
        }
      }
      return null;
    };
    for (const k of ["credits_available", "available_credits", "credits_remaining",
                     "credit_balance", "extra_credits", "credits", "credit"]) {
      const v = num(raw[k]);
      if (v !== null) return Math.max(0, v);
    }
    return null;
  }

  /* ── Exhausted state ───────────────────────────────── */

  /* When a limit that actually gates chatting is spent, the rings have nothing
   * left to say — the only useful number is how long until it comes back. */
  function blockedUntil(five, seven) {
    const ends = [];
    for (const lim of [five, seven]) {
      if (!lim || !lim.resets_at) continue;
      if (Math.min(lim.utilization ?? 0, 100) < 100) continue;
      const t = new Date(lim.resets_at).getTime();
      if (!Number.isNaN(t) && t > Date.now()) ends.push(t);
    }
    return ends.length ? Math.min(...ends) : null;
  }

  function fmtClock(ms) {
    const mins = Math.max(0, Math.ceil(ms / 60000));
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }

  /* Repaints the countdown only while a limit is spent. No network, and it
   * stands down the moment the wheel goes back to rings. */
  function setTick(on) {
    if (on && !tickTimer) tickTimer = setInterval(onTick, TICK_MS);
    else if (!on && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function onTick() {
    if (document.visibilityState !== "visible") return;
    if (blockedEnd !== null && Date.now() >= blockedEnd) { triggerRefresh(); return; }
    renderWheel(data?.five_hour, data?.seven_day, data);
  }

  /* ── SVG ───────────────────────────────────────────── */

  function renderWheel(five, seven, raw) {
    const svg = root.querySelector("#csw-wheel svg");
    const cx = VB / 2, cy = VB / 2;

    const rDesign  = cx - S_DESIGN / 2 - RIM;
    const rWeekly  = rDesign - S_DESIGN / 2 - GAP - S_WEEKLY / 2;
    const rSession = rWeekly - S_WEEKLY / 2 - GAP - S_SESSION / 2;

    const cD = 2 * Math.PI * rDesign;
    const cW = 2 * Math.PI * rWeekly;
    const cS = 2 * Math.PI * rSession;

    const rR = rDesign + S_DESIGN / 2 + 4;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    blockedEnd = blockedUntil(five, seven);
    setTick(blockedEnd !== null);

    if (blockedEnd !== null) {
      svg.appendChild(svgEl("circle", {
        cx, cy, r: rDesign, fill: "none", stroke: TRACK, "stroke-width": S_DESIGN
      }));
      renderClock(svg, cx, cy, blockedEnd);
      svg.appendChild(refreshRing(cx, cy, rR));
      return;
    }

    const sU = Math.min(five?.utilization  ?? 0, 100);
    const wU = Math.min(seven?.utilization ?? 0, 100);
    const sR = Math.max(0, 100 - sU);
    const wR = Math.max(0, 100 - wU);
    const sC = palette(sU), wC = palette(wU);

    const design = getDesignUtil(raw);
    const dU = design?.utilization ?? 0;
    const dR = Math.max(0, 100 - dU);
    const dC = design ? palette(dU) : { stroke: "rgba(255,255,255,0.06)" };

    /* Dot period divides the circumference exactly, so the pattern closes
     * around the ring with no seam at the 3 o'clock start point. */
    const period = cD / DESIGN_DOTS;
    const ink = period * DESIGN_DUTY;
    const dots = `${ink} ${period - ink}`;

    svg.appendChild(svgEl("circle", {
      cx, cy, r: rWeekly, fill: "none", stroke: TRACK, "stroke-width": S_WEEKLY
    }));
    svg.appendChild(svgEl("circle", {
      cx, cy, r: rSession, fill: "none", stroke: TRACK, "stroke-width": S_SESSION
    }));
    svg.appendChild(svgEl("circle", {
      cx, cy, r: rDesign, fill: "none", stroke: TRACK, "stroke-width": S_DESIGN,
      "stroke-dasharray": dots, "stroke-linecap": "round"
    }));

    if (design && dR > 0.5) {
      /* The dotted ring can't carry progress in its own dash pattern — that
       * would just shift the dots. Draw the full dotted ring and mask it with
       * a plain arc, so colour retracts around the ring like the others do. */
      const whole = dR >= 99.5;
      const colored = svgEl("circle", {
        cx, cy, r: rDesign, fill: "none", stroke: dC.stroke, "stroke-width": S_DESIGN,
        "stroke-linecap": "round", "stroke-dasharray": dots, opacity: "0.85"
      });

      if (!whole) {
        // Snap the cut to a gap between dots so none is sliced in half.
        const n = clamp(Math.round((dR / 100) * cD / period), 1, DESIGN_DOTS - 1);
        const arc = n * period - (period - ink) / 2;

        const mask = svgEl("mask", {
          id: "csw-design-mask", maskUnits: "userSpaceOnUse",
          x: -VB, y: -VB, width: VB * 3, height: VB * 3
        });
        mask.appendChild(svgEl("circle", {
          cx, cy, r: rDesign, fill: "none", stroke: "#fff",
          "stroke-width": S_DESIGN + 2,
          "stroke-dasharray": `${arc} ${cD}`,
          transform: `rotate(-90 ${cx} ${cy})`
        }));
        const defs = svgEl("defs", {});
        defs.appendChild(mask);
        svg.appendChild(defs);
        colored.setAttribute("mask", "url(#csw-design-mask)");
      }
      svg.appendChild(colored);
    }

    svg.appendChild(svgEl("circle", {
      cx, cy, r: rWeekly, fill: "none", stroke: wC.stroke, "stroke-width": S_WEEKLY,
      "stroke-linecap": "round",
      "stroke-dasharray": `${(wR / 100) * cW} ${cW}`,
      transform: `rotate(-90 ${cx} ${cy})`
    }));

    svg.appendChild(svgEl("circle", {
      cx, cy, r: rSession, fill: "none", stroke: sC.stroke, "stroke-width": S_SESSION,
      "stroke-linecap": "round",
      "stroke-dasharray": `${(sR / 100) * cS} ${cS}`,
      transform: `rotate(-90 ${cx} ${cy})`
    }));

    svg.appendChild(refreshRing(cx, cy, rR));
  }

  /* Hours:minutes until the spent limit comes back, filling the wheel in
   * place of the rings. Type is sized to the string so a multi-day weekly
   * reset ("168:00") fits the same circle as a session one. */
  function renderClock(svg, cx, cy, until) {
    const txt = fmtClock(until - Date.now());
    const label = svgEl("text", {
      x: cx, y: cy + 1,
      "text-anchor": "middle", "dominant-baseline": "central",
      "font-size": Math.min(CLOCK_FS, (VB - 14) / (0.56 * txt.length)),
      "font-weight": "600", fill: palette(100).stroke,
      "font-family": "inherit", "letter-spacing": "-0.02em",
      "font-variant-numeric": "tabular-nums"
    });
    label.textContent = txt;
    svg.appendChild(label);
  }

  function refreshRing(cx, cy, rR) {
    const cR = 2 * Math.PI * rR;
    const g = svgEl("g", { id: "csw-refresh-ring" });
    g.appendChild(svgEl("circle", {
      cx, cy, r: rR, fill: "none", stroke: REFRESH_CLR, "stroke-width": "5",
      "stroke-linecap": "round",
      "stroke-dasharray": `${cR * 0.15} ${cR * 0.85}`,
      "transform-origin": `${cx} ${cy}`
    }));
    return g;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* ── Reset formatting ──────────────────────────────── */

  // Short windows read best as a countdown.
  function fmtIn(iso) {
    if (!iso) return "—";
    const d = new Date(iso) - Date.now();
    if (Number.isNaN(d)) return "—";
    if (d <= 0) return "now";
    const m = Math.floor(d / 60000), h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }

  // Multi-day windows read best as an absolute weekday + clock time.
  function fmtAt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      weekday: "short", hour: "numeric", minute: "2-digit"
    });
  }

  function renderTip(five, seven, raw) {
    const tip = root.querySelector("#csw-tip");
    const sU = Math.min(five?.utilization  ?? 0, 100);
    const wU = Math.min(seven?.utilization ?? 0, 100);
    const sC = palette(sU), wC = palette(wU);

    const design = getDesignUtil(raw);
    const dU = design?.utilization ?? null;
    const dC = dU !== null ? palette(dU) : { stroke: "#737373" };

    while (tip.firstChild) tip.removeChild(tip.firstChild);

    if (orgName) {
      const orgDiv = document.createElement("div");
      orgDiv.className = "csw-org";
      orgDiv.textContent = orgName;
      tip.appendChild(orgDiv);
    }

    tip.appendChild(tipRow(sC.stroke, "Session", `${Math.round(100 - sU)}%`, sC.stroke));
    tip.appendChild(tipRow(wC.stroke, "Weekly", `${Math.round(100 - wU)}%`, wC.stroke));
    tip.appendChild(tipRow(
      dC.stroke, "Design",
      dU !== null ? `${Math.round(100 - dU)}%` : "—",
      dC.stroke,
      dU === null
    ));

    // No ring for credits — they're a balance, not a window.
    const credits = getCredits(raw);
    if (credits !== null) {
      tip.appendChild(tipRow(
        "#737373", "Credits",
        credits.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        "hsl(var(--text-100, 0 0% 90%))"
      ));
    }

    const reset = document.createElement("div");
    reset.className = "csw-reset";
    reset.appendChild(document.createTextNode(`Session resets in ${fmtIn(five?.resets_at)}`));
    reset.appendChild(document.createElement("br"));
    reset.appendChild(document.createTextNode(`Weekly resets ${fmtAt(seven?.resets_at)}`));
    if (design?.resets_at) {
      reset.appendChild(document.createElement("br"));
      reset.appendChild(document.createTextNode(`Design resets ${fmtAt(design.resets_at)}`));
    }
    tip.appendChild(reset);
  }

  function tipRow(dotColor, label, valueText, valueColor, dotDimmed) {
    const row = document.createElement("div");
    row.className = "csw-row";
    const dot = document.createElement("span");
    dot.className = "csw-dot";
    dot.style.background = dotColor;
    if (dotDimmed) dot.style.opacity = "0.3";
    const lbl = document.createElement("span");
    lbl.className = "csw-label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "csw-val";
    val.style.color = valueColor;
    val.textContent = valueText;
    row.append(dot, lbl, val);
    return row;
  }

  function setRefreshing(on) {
    const r = root.querySelector("#csw-refresh-ring");
    if (r) r.classList.toggle("csw-active", on);
  }

  /* ── Placement ─────────────────────────────────────── */
  /* The wheel floats free — it is not anchored to any page element, so a
   * Claude UI reshuffle can never strand it. Position is kept as a fraction
   * of the free space so it survives window resizes and restores sensibly
   * on a differently sized screen. */

  function savePos() {
    try { localStorage.setItem(POS_KEY, JSON.stringify(frac)); } catch (e) { /* private mode */ }
  }

  function loadPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (p && Number.isFinite(p.fx) && Number.isFinite(p.fy)) {
        return { fx: clamp(p.fx, 0, 1), fy: clamp(p.fy, 0, 1) };
      }
    } catch (e) { /* private mode or corrupt value */ }
    return null;
  }

  function place(x, y, persist) {
    const b = root.getBoundingClientRect();
    const spanX = Math.max(1, window.innerWidth  - b.width);
    const spanY = Math.max(1, window.innerHeight - b.height);
    x = clamp(x, EDGE_PAD, Math.max(EDGE_PAD, spanX - EDGE_PAD));
    y = clamp(y, EDGE_PAD, Math.max(EDGE_PAD, spanY - EDGE_PAD));

    root.style.left = Math.round(x) + "px";
    root.style.top = Math.round(y) + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";

    frac = { fx: x / spanX, fy: y / spanY };
    updateTipSide();
    if (persist) savePos();
  }

  function placeFrac(f) {
    const b = root.getBoundingClientRect();
    place(f.fx * Math.max(1, window.innerWidth  - b.width),
          f.fy * Math.max(1, window.innerHeight - b.height), false);
  }

  function updateTipSide() {
    const b = root.getBoundingClientRect();
    const onRightHalf = b.left + b.width / 2 > window.innerWidth / 2;
    root.classList.toggle("csw-tip-left", onRightHalf);
    root.classList.toggle("csw-tip-right", !onRightHalf);

    // The tooltip is centered on the wheel; nudge it back in when the wheel
    // sits close enough to the top or bottom edge to clip it.
    const h = root.querySelector("#csw-tip").getBoundingClientRect().height;
    if (h) {
      const center = b.top + b.height / 2;
      const lo = EDGE_PAD + h / 2;
      const hi = Math.max(lo, window.innerHeight - EDGE_PAD - h / 2);
      root.style.setProperty("--csw-tip-shift", Math.round(clamp(center, lo, hi) - center) + "px");
    }
  }

  /* ── Drag ──────────────────────────────────────────── */

  function initDrag(wheel) {
    let pid = null, moved = false, startX = 0, startY = 0, offX = 0, offY = 0;

    wheel.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || pid !== null) return;
      const b = root.getBoundingClientRect();
      suppressClick = false;   // clear any flag a previous drag left behind
      pid = e.pointerId;
      moved = false;
      startX = e.clientX; startY = e.clientY;
      offX = e.clientX - b.left; offY = e.clientY - b.top;
      wheel.setPointerCapture(pid);
      e.preventDefault();
    });

    wheel.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pid) return;
      if (!moved) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_SLOP) return;
        moved = true;
        root.classList.add("csw-dragging");
        hideTip();
      }
      place(e.clientX - offX, e.clientY - offY, false);
    });

    const end = (e) => {
      if (e.pointerId !== pid) return;
      if (wheel.hasPointerCapture(pid)) wheel.releasePointerCapture(pid);
      pid = null;
      if (moved) {
        root.classList.remove("csw-dragging");
        savePos();
        suppressClick = true;   // don't toggle the tooltip on the drag's click
      }
    };
    wheel.addEventListener("pointerup", end);
    wheel.addEventListener("pointercancel", end);
  }

  /* ── Chatbox ──────────────────────────────────────── */

  const CHATBOX_SEL = 'textarea, [contenteditable="true"], [role="textbox"], div.ProseMirror';

  function isChatbox(el) {
    return el && el.nodeType === 1 && el.matches && el.matches(CHATBOX_SEL);
  }

  /* ── Active org resolution ────────────────────────── */

  function readCookieOrg() {
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function resolveActiveOrg() {
    const cookieUuid = readCookieOrg();
    try {
      const res = await fetch("https://claude.ai/api/organizations", { credentials: "include" });
      if (!res.ok) {
        const err = new Error(res.status);
        err.status = res.status;
        throw err;
      }
      const orgs = await res.json();
      if (!Array.isArray(orgs) || !orgs.length) return false;
      const pick = (cookieUuid && orgs.find((o) => o.uuid === cookieUuid)) || orgs[0];
      const changed = pick.uuid !== orgId;
      orgId = pick.uuid;
      orgName = pick.name || null;
      return changed;
    } catch (e) {
      console.warn("[staminai] org resolve error:", e);
      if (e && e.status) throw e;
      return false;
    }
  }

  /* ── Refresh w/ backoff ───────────────────────────── */

  function debouncedRefresh() {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastRefresh < DEBOUNCE_MS) return;
    lastRefresh = Date.now();
    triggerRefresh();
  }

  function applyBackoff(status, retryAfter) {
    const now = Date.now();
    let hdrMs = 0;
    if (retryAfter) {
      const n = Number(retryAfter);
      if (!Number.isNaN(n)) hdrMs = n * 1000;
      else {
        const t = Date.parse(retryAfter);
        if (!Number.isNaN(t)) hdrMs = Math.max(0, t - now);
      }
    }
    if (status === 429) {
      const laddered = BACKOFF_429[Math.min(retry429Step, BACKOFF_429.length - 1)];
      cooldownUntil = now + Math.max(hdrMs, laddered);
      retry429Step = Math.min(retry429Step + 1, BACKOFF_429.length - 1);
    } else if (status >= 500 && status < 600) {
      cooldownUntil = now + Math.max(hdrMs, BACKOFF_5XX);
    } else if (hdrMs > 0) {
      cooldownUntil = now + hdrMs;
    }
  }

  async function triggerRefresh() {
    if (Date.now() < cooldownUntil) {
      root.querySelector("#csw-wheel").classList.add("csw-error");
      return;
    }
    setRefreshing(true);
    const wheel = root.querySelector("#csw-wheel");
    try {
      if (!orgId) await resolveActiveOrg();
      else {
        const cookieUuid = readCookieOrg();
        if (cookieUuid && cookieUuid !== orgId) {
          data = null;
          await resolveActiveOrg();
        }
      }
      if (!orgId) throw Object.assign(new Error("No orgId"), { status: 0 });

      const res = await fetch(
        `https://claude.ai/api/organizations/${orgId}/usage`,
        { credentials: "include" }
      );
      if (!res.ok) {
        applyBackoff(res.status, res.headers.get("Retry-After"));
        const err = new Error(res.status);
        err.status = res.status;
        throw err;
      }
      data = await res.json();
      retry429Step = 0;
      cooldownUntil = 0;
      wheel.classList.remove("csw-loading", "csw-error");
      renderWheel(data.five_hour, data.seven_day, data);
      renderTip(data.five_hour, data.seven_day, data);
    } catch (e) {
      console.warn("[staminai] Usage error:", e);
      wheel.classList.add("csw-error");
      if (!data) {
        wheel.classList.remove("csw-loading");
        renderWheel(null, null, null);
        renderTip(null, null, null);
      }
    } finally { setRefreshing(false); }
  }

  /* ── Tooltip ───────────────────────────────────────── */

  function showTip()  { updateTipSide(); root.querySelector("#csw-tip").classList.add("csw-show"); expanded = true; clearTimeout(fadeTimer); }
  function hideTip()  { root.querySelector("#csw-tip").classList.remove("csw-show"); expanded = false; clearTimeout(fadeTimer); }
  function schedFade(){ clearTimeout(fadeTimer); fadeTimer = setTimeout(hideTip, FADE_MS); }

  /* ── Init ──────────────────────────────────────────── */

  function init() {
    document.body.appendChild(root);

    const wheel = root.querySelector("#csw-wheel");
    wheel.classList.add("csw-loading");
    renderWheel(null, null, null);

    placeFrac(loadPos() || frac);
    initDrag(wheel);

    wheel.addEventListener("mouseenter", () => {
      if (root.classList.contains("csw-dragging")) return;
      showTip(); schedFade();
      debouncedRefresh();
    });

    wheel.addEventListener("click", (e) => {
      e.stopPropagation();
      if (suppressClick) { suppressClick = false; return; }
      expanded ? hideTip() : (showTip(), schedFade());
    });

    root.addEventListener("mouseenter", () => { if (expanded) clearTimeout(fadeTimer); });
    root.addEventListener("mouseleave", () => { if (!root.classList.contains("csw-dragging")) hideTip(); });
    document.addEventListener("click", (e) => { if (expanded && !root.contains(e.target)) hideTip(); });

    // Event-delegated chatbox bindings (no observers, no polling)
    document.addEventListener("focusin", (e) => {
      if (isChatbox(e.target)) debouncedRefresh();
    }, true);
    document.addEventListener("click", (e) => {
      if (isChatbox(e.target)) debouncedRefresh();
    }, true);

    // Keep the wheel on screen (and correctly scaled) when the window changes.
    window.addEventListener("resize", () => placeFrac(frac));

    triggerRefresh();
  }

  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
