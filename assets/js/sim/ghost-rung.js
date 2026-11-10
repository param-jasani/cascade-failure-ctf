// C4 - Ghost Rung. A hidden rung lives in %DB99 that the workstation never renders.
// Satisfy its trigger (P2 forced + level>setpoint + 7 s TON + three %I0.3 pulses within
// 5 s + C3 word 0x7A4F in %MW50) and the backdoor config materialises in %MW200-215.
import { injectCSS, h, panel, led, kv } from "./simui.js";

const SETPOINT = 8.50;          // m
const TON_PRESET = 7000;        // ms
const PULSE_WINDOW = 5000;      // ms
const PULSES_REQ = 3;
const MW50_REQUIRED = 0x7A4F;   // the C3 diagnostic word (31311)
const BACKDOOR = "gh0st:db99:9.20:p2off";   // revealed in %MW200-215 on trigger

// Illustrative compiled bytes for the hidden rung (what "Dump %DB99" shows).
const DB99 = [
  0x01,0x12, 0x40,0x1A, 0x30,0x6D,0x10, 0x21,0x03,0x05, 0x14,0x7A,0x4F,
  0x55,0xC8,0x00, 0x90,0x00,0xC8,0x00,0x10, 0xAB,0xCD,0xEF,
];
const DB99_LEGEND = [
  "off  bytes      disasm",
  "000  01 12      LD    %Q1.2",
  "002  40 1A      CMP   %IW64,%MW10",
  "004  30 6D 10   TON   #7000",
  "007  21 03 05   CTU   #3,#5000",
  "010  14 7A 4F   EQ    %MW50,#7A4F",
  "013  55 C8 00   MOV   @CFG,%MW200",
  "016  90 00      ANDN  ; vote chain",
];

export function mount(root, ctx) {
  injectCSS();
  const st = {
    p2: false, level: 7.0, mw50: 0,
    ton: 0, pulses: [], dumped: false, fired: false,
    mw200: new Array(16).fill(0),
  };

  // ---- controls ----
  const p2Btn = h("button", { class: "sim-btn alt", onclick: () => { st.p2 = !st.p2; p2Btn.classList.toggle("alt", !st.p2); p2Btn.textContent = st.p2 ? "P2 FORCED ON" : "FORCE P2"; } }, "FORCE P2");
  const lvl = h("input", { class: "sim-input", type: "range", min: "600", max: "920", value: "700", style: "width:180px", oninput: (e) => { st.level = (+e.target.value) / 100; } });
  const mw50In = h("input", { class: "sim-input", type: "text", placeholder: "%MW50 (dec or 0x..)", oninput: (e) => {
    const v = e.target.value.trim(); st.mw50 = v.startsWith("0x") || v.startsWith("0X") ? (parseInt(v, 16) || 0) : (parseInt(v, 10) || 0);
  } });
  const pulseBtn = h("button", { class: "sim-btn", onclick: () => { st.pulses.push(performance.now()); } }, "PULSE %I0.3");
  const dumpBtn = h("button", { class: "sim-btn warn", onclick: () => { st.dumped = true; renderDump(); } }, "DUMP %DB99");

  const forcePanel = panel("I/O Force Panel", [
    h("div", { class: "sim-row" }, [p2Btn]),
    h("div", { class: "sim-row" }, [h("span", { class: "sim-dim", text: "level" }), lvl, h("b", { id: "gr-lvl", text: "7.00 m" })]),
    h("div", { class: "sim-row" }, [h("span", { class: "sim-dim", text: "%MW50" }), mw50In]),
    h("div", { class: "sim-row" }, [pulseBtn, h("span", { class: "sim-dim", id: "gr-pulse", text: "0 in 5 s" })]),
  ]);

  // ---- checksum diff ----
  const chkPanel = panel("Online / Offline Checksum", [
    kv("Offline (project on disk)", "0x5B2A"),
    kv("Online (running in PLC)", h("b", { class: "sim-bad", text: "0x6F13" })),
    h("div", { class: "sim-row" }, [h("span", { class: "sim-bad", text: "MISMATCH" }), h("span", { class: "sim-dim", text: `Δ = 24 bytes = size of an undisplayed block` })]),
    h("div", { class: "sim-row" }, [dumpBtn]),
    h("pre", { class: "sim-mono", id: "gr-dump", text: "(dump %DB99 to see the hidden bytecode)" }),
  ]);

  // ---- memory viewer ----
  const memPre = h("pre", { class: "sim-mono", id: "gr-mem" });
  const memPanel = panel("Memory Viewer", [memPre]);

  // ---- ladder canvas ----
  const cv = h("canvas", { class: "sim-canvas", width: "640", height: "200" });
  const ladderPanel = panel("Ladder View (workstation render)", [cv]);

  root.appendChild(h("div", { class: "sim-wrap" }, [
    h("div", { class: "sim-grid" }, [chkPanel, forcePanel]),
    h("div", { class: "sim-grid" }, [ladderPanel, memPanel]),
  ]));

  function renderDump() {
    const hex = DB99.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    document.getElementById("gr-dump").textContent =
      "%DB99 raw (" + DB99.length + " B):\n" + hex + "\n\ndisassembly:\n" + DB99_LEGEND.join("\n");
  }

  function drawLadder() {
    const g = cv.getContext("2d");
    g.clearRect(0, 0, 640, 200);
    g.strokeStyle = "#1f3a3d"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(16, 10); g.lineTo(16, 190); g.moveTo(624, 10); g.lineTo(624, 190); g.stroke();
    g.font = '12px "JetBrains Mono",monospace'; g.fillStyle = "#9fe";
    const rung = (y, label, conds, live) => {
      g.strokeStyle = "#5ce1e6"; g.beginPath(); g.moveTo(16, y); g.lineTo(624, y); g.stroke();
      let x = 60;
      conds.forEach((c) => {
        g.strokeStyle = c.on ? "#00e676" : "#6aa7ab"; g.lineWidth = 2;
        g.strokeRect(x, y - 10, 16, 20); g.fillStyle = "#9fe"; g.fillText(c.t, x - 6, y - 16); x += 90;
      });
      g.fillStyle = live ? "#00e676" : "#6aa7ab"; g.fillText(label, 540, y - 16);
      g.strokeStyle = live ? "#00e676" : "#6aa7ab"; g.beginPath(); g.arc(590, y, 9, 0, 7); g.stroke();
    };
    rung(40, "P1 (clean)", [{ t: "LT101", on: true }, { t: "AUTO", on: true }], true);
    rung(90, "ALM (clean)", [{ t: "HH", on: st.level >= SETPOINT }], st.level >= SETPOINT);
    // hidden rung only drawn once dumped
    g.fillStyle = st.dumped ? "#ffeb3b" : "#333";
    g.fillText(st.dumped ? "HIDDEN RUNG (from %DB99):" : "[ rung 3: not rendered by workstation ]", 60, 140);
    if (st.dumped) {
      rung(165, st.fired ? "MW200" : "MOV",
        [{ t: "Q1.2", on: st.p2 }, { t: "CMP", on: st.level >= SETPOINT }, { t: "T", on: st.ton >= TON_PRESET }, { t: "C", on: pulseCount() >= PULSES_REQ }, { t: "EQ", on: st.mw50 === MW50_REQUIRED }],
        st.fired);
    }
  }

  function pulseCount() {
    const now = performance.now();
    st.pulses = st.pulses.filter((t) => now - t <= PULSE_WINDOW);
    return st.pulses.length;
  }

  function fire() {
    st.fired = true;
    const b = [];
    for (let i = 0; i < 32; i++) b.push(i < BACKDOOR.length ? BACKDOOR.charCodeAt(i) : 0x20);
    for (let i = 0; i < 16; i++) st.mw200[i] = (b[2 * i] << 8) | b[2 * i + 1];
    ctx.onReveal(BACKDOOR);
  }

  let last = performance.now();
  const tick = () => {
    if (!document.body.contains(root)) { clearInterval(iv); return; }
    const now = performance.now(), dt = now - last; last = now;
    const base = st.p2 && st.level >= SETPOINT;
    st.ton = base ? Math.min(TON_PRESET, st.ton + dt) : 0;
    const ready = base && st.ton >= TON_PRESET && pulseCount() >= PULSES_REQ && st.mw50 === MW50_REQUIRED;
    if (ready && !st.fired) fire();

    document.getElementById("gr-lvl").textContent = st.level.toFixed(2) + " m";
    document.getElementById("gr-pulse").textContent = pulseCount() + " in 5 s";
    const mwHex = st.mw200.map((w) => w.toString(16).padStart(4, "0")).join(" ");
    const mwAscii = st.mw200.map((w) => String.fromCharCode((w >> 8) & 0xff, w & 0xff)).join("");
    document.getElementById("gr-mem").textContent =
      `%Q1.2        : ${st.p2 ? 1 : 0}\n` +
      `%IW64        : ${Math.round(st.level * 100)}\n` +
      `T#ACC        : ${Math.round(st.ton)} ms\n` +
      `C#ACC        : ${pulseCount()}\n` +
      `%MW50        : 0x${(st.mw50 >>> 0).toString(16).padStart(4, "0")}\n` +
      `%MW200..215  :\n${mwHex}\n` +
      (st.fired ? `ASCII> ${mwAscii.replace(/ +$/, "")}` : ``);
    drawLadder();
  };
  const iv = setInterval(tick, 100);
  tick();
}
