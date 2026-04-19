/* ── staminai · content.js ─── v2.1 ─────────────────
 *  The AI token stamina wheel for Claude
 *  Dialectic Acheropoieton of Heracles Papatheodorou and Claude
 *  MIT License · https://heracl.es/staminai
 * ──────────────────────────────────────────────────── */

(function () {
  "use strict";

  const FADE_MS = 4000, DEBOUNCE_MS = 3000;
  const FALLBACK_SIZE = 24, AVATAR_GAP = 8, SIZE_SCALE = 0.72;

  const S_SESSION = 3.5;             // inner ring
  const S_WEEKLY  = S_SESSION * 0.5; // middle ring
  const S_DESIGN  = 1;               // outer ring (Claude Design)
  const GAP       = 1.5;

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
  let fadeTimer = null, lastRefresh = 0, curSize = FALLBACK_SIZE;
  let cooldownUntil = 0, retry429Step = 0;

  const root = document.createElement("div");
  root.id = "csw-root";
  root.innerHTML = `
    <div id="csw-tip"></div>
    <div id="csw-wheel">
      <svg xmlns="http://www.w3.org/2000/svg"></svg>
    </div>`;

  function displayValue(remaining) {
    const v = Math.round(remaining);
    return v === 100 ? "%" : String(v);
  }

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

  /* ── SVG ───────────────────────────────────────────── */

  function renderWheel(five, seven, raw) {
    const size = curSize;
    const svg = root.querySelector("#csw-wheel svg");
    const wheel = root.querySelector("#csw-wheel");
    wheel.style.width = size + "px";
    wheel.style.height = size + "px";
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

    const cx = size / 2, cy = size / 2;

    const rDesign  = cx - S_DESIGN / 2 - 0.5;
    const rWeekly  = rDesign - S_DESIGN / 2 - GAP - S_WEEKLY / 2;
    const rSession = rWeekly - S_WEEKLY / 2 - GAP - S_SESSION / 2;

    const cD = 2 * Math.PI * rDesign;
    const cW = 2 * Math.PI * rWeekly;
    const cS = 2 * Math.PI * rSession;

    const rR = rDesign + S_DESIGN / 2 + 1.5;
    const cR = 2 * Math.PI * rR;

    const sU = Math.min(five?.utilization  ?? 0, 100);
    const wU = Math.min(seven?.utilization ?? 0, 100);
    const sR = Math.max(0, 100 - sU);
    const wR = Math.max(0, 100 - wU);
    const sC = palette(sU), wC = palette(wU);

    const design = getDesignUtil(raw);
    const dU = design?.utilization ?? 0;
    const dR = Math.max(0, 100 - dU);
    const dC = design ? palette(dU) : { stroke: "rgba(255,255,255,0.06)" };
    const hasDesign = design !== null;

    svg.innerHTML = `
      <circle cx="${cx}" cy="${cy}" r="${rWeekly}"
        fill="none" stroke="${TRACK}" stroke-width="${S_WEEKLY}"/>
      <circle cx="${cx}" cy="${cy}" r="${rSession}"
        fill="none" stroke="${TRACK}" stroke-width="${S_SESSION}"/>

      <circle cx="${cx}" cy="${cy}" r="${rDesign}"
        fill="none" stroke="${TRACK}" stroke-width="${S_DESIGN}"
        stroke-dasharray="1.5 3" stroke-linecap="round"/>

      ${hasDesign && dR > 0.5 ? `
      <circle cx="${cx}" cy="${cy}" r="${rDesign}"
        fill="none" stroke="${dC.stroke}" stroke-width="${S_DESIGN}"
        stroke-linecap="round"
        stroke-dasharray="1.5 3"
        stroke-dashoffset="${-((1 - dR / 100) * cD)}"
        pathLength="${cD}"
        transform="rotate(-90 ${cx} ${cy})"
        opacity="0.8"/>` : ""}

      <circle cx="${cx}" cy="${cy}" r="${rWeekly}"
        fill="none" stroke="${wC.stroke}" stroke-width="${S_WEEKLY}"
        stroke-linecap="round"
        stroke-dasharray="${(wR / 100) * cW} ${cW}"
        transform="rotate(-90 ${cx} ${cy})"/>

      <circle cx="${cx}" cy="${cy}" r="${rSession}"
        fill="none" stroke="${sC.stroke}" stroke-width="${S_SESSION}"
        stroke-linecap="round"
        stroke-dasharray="${(sR / 100) * cS} ${cS}"
        transform="rotate(-90 ${cx} ${cy})"/>

      <g id="csw-refresh-ring">
        <circle cx="${cx}" cy="${cy}" r="${rR}"
          fill="none" stroke="${REFRESH_CLR}" stroke-width="1.5"
          stroke-linecap="round"
          stroke-dasharray="${cR * 0.15} ${cR * 0.85}"
          transform-origin="${cx} ${cy}"/>
      </g>

      <text x="${cx}" y="${cy + 0.5}"
        text-anchor="middle" dominant-baseline="central"
        font-size="10" font-weight="600" fill="${sC.stroke}"
        font-family="inherit" letter-spacing="-0.01em"
        opacity="0.85">${displayValue(sR)}</text>
    `;
  }

  function renderTip(five, seven, raw) {
    const tip = root.querySelector("#csw-tip");
    const sU = Math.min(five?.utilization  ?? 0, 100);
    const wU = Math.min(seven?.utilization ?? 0, 100);
    const sC = palette(sU), wC = palette(wU);

    const design = getDesignUtil(raw);
    const dU = design?.utilization ?? null;
    const dC = dU !== null ? palette(dU) : { stroke: "#737373" };

    const fmt = (iso) => {
      if (!iso) return "\u2014";
      const d = new Date(iso) - Date.now();
      if (d <= 0) return "now";
      const m = Math.floor(d / 60000), h = Math.floor(m / 60);
      return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
    };

    const orgHeader = orgName
      ? `<div class="csw-org">${escapeHtml(orgName)}</div>`
      : "";

    tip.innerHTML = `
      ${orgHeader}
      <div class="csw-row">
        <span class="csw-dot" style="background:${sC.stroke}"></span>
        <span class="csw-label">Session</span>
        <span class="csw-val" style="color:${sC.stroke}">${Math.round(100 - sU)}%</span>
      </div>
      <div class="csw-row">
        <span class="csw-dot" style="background:${wC.stroke}"></span>
        <span class="csw-label">Weekly</span>
        <span class="csw-val" style="color:${wC.stroke}">${Math.round(100 - wU)}%</span>
      </div>
      <div class="csw-row">
        <span class="csw-dot" style="background:${dC.stroke};${dU === null ? "opacity:0.3" : ""}"></span>
        <span class="csw-label">Design</span>
        <span class="csw-val" style="color:${dC.stroke}">${dU !== null ? Math.round(100 - dU) + "%" : "\u2014"}</span>
      </div>
      <div class="csw-reset">
        Session resets in ${fmt(five?.resets_at)}<br>
        Weekly resets in ${fmt(seven?.resets_at)}${design?.resets_at ? "<br>Design resets in " + fmt(design.resets_at) : ""}
      </div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function setRefreshing(on) {
    const r = root.querySelector("#csw-refresh-ring");
    if (r) r.classList.toggle("csw-active", on);
  }

  /* ── Avatar ────────────────────────────────────────── */

  function findAvatar() {
    return document.querySelector('button[data-testid*="user-menu-button"]');
  }

  function anchorToAvatar() {
    const av = findAvatar(); if (!av) return;
    const r = av.getBoundingClientRect();
    const avatarSize = Math.round(Math.max(r.width, r.height));
    const size = Math.round(avatarSize * SIZE_SCALE);
    if (size > 0 && size !== curSize) {
      curSize = size;
      renderWheel(data?.five_hour, data?.seven_day, data);
    }
    root.style.left = Math.round(r.left + r.width / 2 - curSize / 2) + "px";
    root.style.bottom = Math.round(window.innerHeight - r.top + AVATAR_GAP) + "px";
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

  function showTip()  { root.querySelector("#csw-tip").classList.add("csw-show"); expanded = true; clearTimeout(fadeTimer); }
  function hideTip()  { root.querySelector("#csw-tip").classList.remove("csw-show"); expanded = false; clearTimeout(fadeTimer); }
  function schedFade(){ clearTimeout(fadeTimer); fadeTimer = setTimeout(hideTip, FADE_MS); }

  /* ── Init ──────────────────────────────────────────── */

  function init() {
    document.body.appendChild(root);

    const wheel = root.querySelector("#csw-wheel");
    wheel.style.width = curSize + "px";
    wheel.style.height = curSize + "px";
    wheel.classList.add("csw-loading");
    renderWheel(null, null, null);

    wheel.addEventListener("mouseenter", () => {
      anchorToAvatar();
      showTip(); schedFade();
      debouncedRefresh();
    });

    wheel.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded ? hideTip() : (showTip(), schedFade());
    });

    root.addEventListener("mouseenter", () => { if (expanded) clearTimeout(fadeTimer); });
    root.addEventListener("mouseleave", () => { hideTip(); });
    document.addEventListener("click", (e) => { if (expanded && !root.contains(e.target)) hideTip(); });

    // Event-delegated chatbox bindings (no observers, no polling)
    document.addEventListener("focusin", (e) => {
      if (isChatbox(e.target)) { anchorToAvatar(); debouncedRefresh(); }
    }, true);
    document.addEventListener("click", (e) => {
      if (isChatbox(e.target)) { anchorToAvatar(); debouncedRefresh(); }
    }, true);

    window.addEventListener("resize", anchorToAvatar);

    anchorToAvatar();
    triggerRefresh();
  }

  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
