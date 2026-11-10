// C6 - Hot Standby (EASY). The poisoned recipe block %DB10 holds word-swapped (CDAB) REALs.
// Fix them on the primary before the next sync, fail over to the clean standby, and hold the
// tank stable for 60 s. Forgiving: sync is pausable and a miss just prompts a retry.
import { injectCSS, h, panel, led, kv } from "./simui.js";
import { WaterTank } from "./physics.js";

const TOKEN = "standby_clean_1sync";   // revealed when the standby holds for 60 s
const HOLD_S = 60;
const SYNC_S = 20;

// %DB10 layout: 8 REALs. Slots 0..3 are the safety-critical setpoints (attacker poisoned
// these by word-swapping). Slots 4..7 are untouched.
const SLOTS = [
  { name: "HiHi level (m)", good: 8.50, swapped: true },
  { name: "Pump start (m)", good: 6.50, swapped: true },
  { name: "Pump stop (m)",  good: 2.00, swapped: true },
  { name: "Max fill (m3/s)",good: 0.50, swapped: true },
  { name: "LoLo level (m)", good: 1.50, swapped: false },
  { name: "Area (m2)",      good: 12.5664, swapped: false },
  { name: "Setpoint (m)",   good: 5.00, swapped: false },
  { name: "Deadband (m)",   good: 0.20, swapped: false },
];

function floatToWords(v) {
  const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, v, false);
  return [(dv.getUint8(0) << 8) | dv.getUint8(1), (dv.getUint8(2) << 8) | dv.getUint8(3)];
}
function wordsToFloat(w0, w1) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint8(0, (w0 >> 8) & 0xff); dv.setUint8(1, w0 & 0xff);
  dv.setUint8(2, (w1 >> 8) & 0xff); dv.setUint8(3, w1 & 0xff);
  return dv.getFloat32(0, false);
}
const hex4 = (w) => w.toString(16).padStart(4, "0");
const plausible = (v) => Number.isFinite(v) && Math.abs(v) >= 0.05 && Math.abs(v) <= 50;

export function mount(root, ctx) {
  injectCSS();
  const tank = new WaterTank({ level: 5.0 });
  const st = {
    primary: [], standby: [],            // each slot: {w0,w1}
    syncPaused: false, syncLeft: SYNC_S,
    failed: false, active: "primary",    // which runs the tank after failover
    holdLeft: HOLD_S, phase: "repair", revealed: false, msg: "",
  };
  // init primary DB10 (poison the swapped ones), standby starts as a stale copy of primary.
  SLOTS.forEach((s) => {
    const [w0, w1] = floatToWords(s.good);
    st.primary.push(s.swapped ? { w0: w1, w1: w0 } : { w0, w1 });  // swapped => store CDAB
  });
  st.standby = st.primary.map((x) => ({ ...x }));

  const banner = h("div", { class: "sim-row", id: "hs-banner" });
  const tankBar = h("div", { class: "sim-bar" }, [h("i", { id: "hs-bar", style: "width:50%" })]);
  const redPanel = panel("Redundancy / Failover", [
    h("div", { class: "sim-row" }, [h("span", {}, [led(false, "red"), " PRIMARY "]), h("b", { id: "hs-prim", text: "WATCHDOG FAULT" })]),
    h("div", { class: "sim-row" }, [h("span", {}, [led(true, "amber"), " STANDBY "]), h("b", { id: "hs-stby", text: "READY (clean firmware)" })]),
    kv("Next sync in", h("b", { id: "hs-sync", text: SYNC_S + " s" })),
    h("div", { class: "sim-row" }, [
      h("button", { class: "sim-btn", id: "hs-pause", onclick: () => { st.syncPaused = !st.syncPaused; paint(); } }, "PAUSE SYNC"),
      h("button", { class: "sim-btn alt", id: "hs-syncnow", onclick: () => doSync() }, "SYNC NOW"),
      h("button", { class: "sim-btn warn", id: "hs-failover", onclick: () => doFailover() }, "COMPLETE FAILOVER"),
    ]),
    banner,
    h("div", { class: "sim-dim", text: "live tank:" }), tankBar, kv("", h("b", { id: "hs-lvl", text: "5.00 m" })),
  ]);

  // %DB10 editor
  const rows = SLOTS.map((s, i) => h("tr", { id: "hs-slot-" + i }));
  const table = h("table", { style: "width:100%;border-collapse:collapse;font:400 11px/1.4 'JetBrains Mono',monospace" }, [
    h("tr", {}, ["#", "name", "words (ABCD)", "float ABCD", "float CDAB", "fix"].map((t) => h("th", { style: "text-align:left;color:#5ce1e6;border-bottom:1px solid #1f3a3d;padding:3px", text: t }))),
    ...rows,
  ]);
  const editor = panel("%DB10 editor (PRIMARY)", [table]);

  root.appendChild(h("div", { class: "sim-wrap" }, [h("div", { class: "sim-grid" }, [redPanel, editor])]));

  function fixSlot(i) {
    const s = st.primary[i]; const t = s.w0; s.w0 = s.w1; s.w1 = t; // swap words back
    paintEditor();
  }
  function doSync() {
    st.standby = st.primary.map((x) => ({ ...x }));
    st.msg = "sync pulse: primary %DB10 copied to standby.";
    paint();
  }
  function doFailover() {
    if (st.failed) return;
    // auto-run a sync at the moment of failover if not paused-and-synced: standby uses its copy
    st.failed = true; st.active = "standby"; st.phase = "hold"; st.holdLeft = HOLD_S;
    const clean = [0, 1, 2, 3].every((i) => Math.abs(wordsToFloat(st.standby[i].w0, st.standby[i].w1) - SLOTS[i].good) < 0.02);
    st.standbyClean = clean;
    st.msg = clean ? "failover complete onto clean standby. holding..." : "failover onto POISONED standby - tank destabilising!";
    paint();
  }
  function retry() {
    // forgiving reset of the live scenario only (not the whole challenge)
    SLOTS.forEach((s, i) => { const [w0, w1] = floatToWords(s.good); st.primary[i] = s.swapped ? { w0: w1, w1: w0 } : { w0, w1 }; });
    st.standby = st.primary.map((x) => ({ ...x }));
    st.failed = false; st.active = "primary"; st.phase = "repair"; st.holdLeft = HOLD_S; st.syncLeft = SYNC_S; st.syncPaused = false;
    tank.level = 5.0; st.msg = "scenario reset - try again (pause sync, fix DB10, then fail over).";
    paintEditor(); paint();
  }

  function paintEditor() {
    SLOTS.forEach((s, i) => {
      const p = st.primary[i];
      const abcd = wordsToFloat(p.w0, p.w1);
      const cdab = wordsToFloat(p.w1, p.w0);
      const flagged = !plausible(abcd);
      const tr = document.getElementById("hs-slot-" + i);
      tr.innerHTML = "";
      const tds = [
        String(i), s.name, hex4(p.w0) + " " + hex4(p.w1),
        (plausible(abcd) ? abcd.toFixed(3) : "~" + abcd.toExponential(1)),
        cdab.toFixed(3),
      ];
      tds.forEach((t, k) => tr.appendChild(h("td", { style: "padding:3px;border-bottom:1px solid #12282a;color:" + (k === 3 && flagged ? "#ff6b6b" : "#9fe"), text: t })));
      const fixTd = h("td", { style: "padding:3px" });
      if (flagged) fixTd.appendChild(h("button", { class: "sim-btn", style: "padding:3px 6px", onclick: () => fixSlot(i) }, "fix swap"));
      else fixTd.appendChild(h("span", { class: "sim-ok", text: "ok" }));
      tr.appendChild(fixTd);
      tr.style.background = flagged ? "#2a0f10" : "transparent";
    });
  }

  function paint() {
    document.getElementById("hs-sync").textContent = st.syncPaused ? "PAUSED" : st.syncLeft.toFixed(0) + " s";
    document.getElementById("hs-pause").textContent = st.syncPaused ? "RESUME SYNC" : "PAUSE SYNC";
    document.getElementById("hs-prim").textContent = st.failed ? "OFFLINE" : "WATCHDOG FAULT";
    document.getElementById("hs-stby").textContent = st.failed ? (st.standbyClean ? "ACTIVE (clean)" : "ACTIVE (poisoned!)") : "READY (clean firmware)";
    const b = document.getElementById("hs-banner"); b.innerHTML = "";
    if (st.phase === "hold" && !st.revealed) b.appendChild(h("b", { class: st.standbyClean ? "sim-ok" : "sim-bad", text: st.standbyClean ? `holding stable: ${st.holdLeft.toFixed(0)} s left` : "UNSTABLE" }));
    if (st.msg) b.appendChild(h("div", { class: "sim-dim", text: " " + st.msg }));
    if (st.phase === "tripped") {
      b.appendChild(h("button", { class: "sim-btn", onclick: retry }, "RETRY"));
    }
  }

  let last = performance.now();
  const tick = () => {
    if (!document.body.contains(root)) { clearInterval(iv); return; }
    const now = performance.now(), dt = (now - last) / 1000; last = now;

    if (!st.failed && !st.syncPaused && st.phase === "repair") {
      st.syncLeft -= dt;
      if (st.syncLeft <= 0) { st.syncLeft = SYNC_S; doSync(); } // auto sync carries whatever is on primary
    }
    if (st.phase === "hold") {
      // controller drives toward setpoint 5.0 using standby setpoints; clean => stable, poisoned => overflow
      if (st.standbyClean) { tank.inflow = 0.20; tank.outflow = 0.20; }
      else { tank.inflow = 0.50; tank.outflow = 0.0; }
      tank.step(dt);
      if (!st.standbyClean && tank.level >= 9.5) {
        st.phase = "tripped"; st.msg = "tank overflowed -> SIS hard-trip. (forgiving: press RETRY)";
      } else if (st.standbyClean) {
        st.holdLeft -= dt;
        if (st.holdLeft <= 0 && !st.revealed) {
          st.revealed = true; st.phase = "done"; st.msg = "standby held stable for 60 s - recovery token released.";
          ctx.onReveal(TOKEN);
        }
      }
    }
    document.getElementById("hs-lvl").textContent = tank.level.toFixed(2) + " m";
    document.getElementById("hs-bar").style.width = Math.min(100, (tank.level / 10) * 100) + "%";
    paint();
  };
  paintEditor(); paint();
  const iv = setInterval(tick, 200);
  tick();
}
