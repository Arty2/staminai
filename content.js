/* ── staminai · content.js ─── v2.0 ─────────────────
 *  The AI token stamina wheel for Claude
 *  Dialectic Acheropoieton of Heracles Papatheodorou and Claude
 *  MIT License · https://heracl.es/staminai
 * ──────────────────────────────────────────────────── */

(function () {
  "use strict";

  const FADE_MS = 4000, ANCHOR_POLL_MS = 2000, DEBOUNCE_MS = 3000;
  const FALLBACK_SIZE = 24, AVATAR_GAP = 8, SIZE_SCALE = 0.72;

  const S_SESSION = 3.5;             // inner ring
  const S_WEEKLY  = S_SESSION * 0.5; // middle ring
  const S_DESIGN  = 1;               // outer ring (Claude Design)
  const GAP       = 1.5;

  const TRACK       = "rgba(255,255,255,0.07)";
  const REFRESH_CLR = "rgba(255,255,255,0.22)";

  const palette = (pct) => {
    const r = 100 - pct;
    if (r > 50) return { stroke: "#5ec269" };
    if (r > 25) return { stroke: "#e8c840" };
    if (r > 10) return { stroke: "#e87040" };
    return              { stroke: "#e84060" };
  };

  let orgId = null, data = null, expanded = false;
  let fadeTimer = null, lastRefresh = 0, curSize = FALLBACK_SIZE;
  let chatboxBound = false;

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
    // Check possible field names the API may use
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

    // Radii outside→in: design → weekly → session
    const rDesign  = cx - S_DESIGN / 2 - 0.5;
    const rWeekly  = rDesign - S_DESIGN / 2 - GAP - S_WEEKLY / 2;
    const rSession = rWeekly - S_WEEKLY / 2 - GAP - S_SESSION / 2;

    const cD = 2 * Math.PI * rDesign;
    const cW = 2 * Math.PI * rWeekly;
    const cS = 2 * Math.PI * rSession;

    // Refresh ring outside everything
    const rR = rDesign + S_DESIGN / 2 + 1.5;
    const cR = 2 * Math.PI * rR;

    const sU = Math.min(five?.utilization  ?? 0, 100);
    const wU = Math.min(seven?.utilization ?? 0, 100);
    const sR = Math.max(0, 100 - sU);
    const wR = Math.max(0, 100 - wU);
    const sC = palette(sU), wC = palette(wU);

    // Design ring
    const design = getDesignUtil(raw);
    const dU = design?.utilization ?? 0;
    const dR = Math.max(0, 100 - dU);
    const dC = design ? palette(dU) : { stroke: "rgba(255,255,255,0.06)" };
    const hasDesign = design !== null;

    svg.innerHTML = `
      <!-- Tracks -->
      <circle cx="${cx}" cy="${cy}" r="${rWeekly}"
        fill="none" stroke="${TRACK}" stroke-width="${S_WEEKLY}"/>
      <circle cx="${cx}" cy="${cy}" r="${rSession}"
        fill="none" stroke="${TRACK}" stroke-width="${S_SESSION}"/>

      <!-- Design track (dotted, always visible) -->
      <circle cx="${cx}" cy="${cy}" r="${rDesign}"
        fill="none" stroke="${TRACK}" stroke-width="${S_DESIGN}"
        stroke-dasharray="1.5 3" stroke-linecap="round"/>

      <!-- Design value (dotted arc, colored when data available) -->
      ${hasDesign && dR > 0.5 ? `
      <circle cx="${cx}" cy="${cy}" r="${rDesign}"
        fill="none" stroke="${dC.stroke}" stroke-width="${S_DESIGN}"
        stroke-linecap="round"
        stroke-dasharray="1.5 3"
        stroke-dashoffset="${-((1 - dR / 100) * cD)}"
        pathLength="${cD}"
        transform="rotate(-90 ${cx} ${cy})"
        opacity="0.8"/>` : ""}

      <!-- Weekly (middle, thin) -->
      <circle cx="${cx}" cy="${cy}" r="${rWeekly}"
        fill="none" stroke="${wC.stroke}" stroke-width="${S_WEEKLY}"
        stroke-linecap="round"
        stroke-dasharray="${(wR / 100) * cW} ${cW}"
        transform="rotate(-90 ${cx} ${cy})"/>

      <!-- Session (inner, thick) -->
      <circle cx="${cx}" cy="${cy}" r="${rSession}"
        fill="none" stroke="${sC.stroke}" stroke-width="${S_SESSION}"
        stroke-linecap="round"
        stroke-dasharray="${(sR / 100) * cS} ${cS}"
        transform="rotate(-90 ${cx} ${cy})"/>

      <!-- Refresh spinner -->
      <g id="csw-refresh-ring">
        <circle cx="${cx}" cy="${cy}" r="${rR}"
          fill="none" stroke="${REFRESH_CLR}" stroke-width="1.5"
          stroke-linecap="round"
          stroke-dasharray="${cR * 0.15} ${cR * 0.85}"
          transform-origin="${cx} ${cy}"/>
      </g>

      <!-- Center number -->
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

    tip.innerHTML = `
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

  function setRefreshing(on) {
    const r = root.querySelector("#csw-refresh-ring");
    if (r) r.classList.toggle("csw-active", on);
  }

  /* ── Avatar ────────────────────────────────────────── */

  const AVATAR_SEL = [
    'button[data-testid="user-button"]',
    'button[data-testid="sidebar-user-menu"]',
    'button[aria-label*="rofile"]',
    'button[aria-label*="ccount"]',
  ];

  function findAvatar() {
    for (const sel of AVATAR_SEL) {
      const el = document.querySelector(sel); if (el) return el;
    }
    const btns = document.querySelectorAll("nav button, aside button");
    let best = null, bestY = -1;
    for (const b of btns) {
      const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
      if (d >= 20 && d <= 48 && r.bottom > window.innerHeight * 0.7 && r.bottom > bestY) {
        bestY = r.bottom; best = b;
      }
    }
    return best;
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

  /* ── Chatbox focus ─────────────────────────────────── */

  const CHATBOX_SEL = ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'div.ProseMirror'];

  function findChatbox() {
    for (const sel of CHATBOX_SEL) {
      const el = document.querySelector(sel); if (el) return el;
    }
    return null;
  }

  function debouncedRefresh() {
    if (Date.now() - lastRefresh < DEBOUNCE_MS) return;
    lastRefresh = Date.now();
    triggerRefresh();
  }

  function hookChatbox() {
    if (chatboxBound) return;
    const cb = findChatbox(); if (!cb) return;
    cb.addEventListener("focus", debouncedRefresh, true);
    cb.addEventListener("click", debouncedRefresh, true);
    chatboxBound = true;
    const obs = new MutationObserver(() => {
      const current = findChatbox();
      if (current && current !== cb) {
        cb.removeEventListener("focus", debouncedRefresh, true);
        cb.removeEventListener("click", debouncedRefresh, true);
        chatboxBound = false;
        hookChatbox();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ── API ───────────────────────────────────────────── */

  async function getOrgId() {
    if (orgId) return orgId;
    try {
      const res = await fetch("https://claude.ai/api/organizations", { credentials: "include" });
      if (!res.ok) throw new Error(res.status);
      const orgs = await res.json();
      if (orgs?.length) orgId = orgs[0].uuid;
      return orgId;
    } catch (e) { console.warn("[staminai] orgId error:", e); return null; }
  }

  async function triggerRefresh() {
    setRefreshing(true);
    const wheel = root.querySelector("#csw-wheel");
    try {
      const oid = await getOrgId(); if (!oid) throw new Error("No orgId");
      const res = await fetch(
        `https://claude.ai/api/organizations/${oid}/usage`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
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

    // Hover: show tooltip + refresh
    wheel.addEventListener("mouseenter", () => {
      showTip(); schedFade();
      debouncedRefresh();
    });

    // Click: just toggle tooltip
    wheel.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded ? hideTip() : (showTip(), schedFade());
    });

    root.addEventListener("mouseenter", () => { if (expanded) clearTimeout(fadeTimer); });
    root.addEventListener("mouseleave", () => { hideTip(); });
    document.addEventListener("click", (e) => { if (expanded && !root.contains(e.target)) hideTip(); });

    triggerRefresh();
    anchorToAvatar();
    hookChatbox();
    setInterval(() => { anchorToAvatar(); hookChatbox(); }, ANCHOR_POLL_MS);
    window.addEventListener("resize", anchorToAvatar);
  }

  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
