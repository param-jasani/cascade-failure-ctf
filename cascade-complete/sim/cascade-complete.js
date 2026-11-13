// C5 - Cascade Complete. Replay the attack against an in-browser plant, then recover the
// implant's Manchester-encoded exfil from the raw 4-20 mA level signal while the HMI lies.
import { injectCSS, h, panel, led, kv } from "./simui.js";
import { WaterTank } from "./physics.js";

const C1_IP_HASH = "ed019053c00f241db13210770ebb713102f3812a7558af1285082a92f7851248";
const C4_CFG_HASH = "fac1be3011d7d66b1b0c3a3059b55b2f71345fd31de41f9007887db206b91a7d";
const C3_WORD = 0x7A4F;
const MESSAGE = "CASCADE-DONE";      // what the pump taps out in Manchester
const PREAMBLE = [1, 0, 1, 0, 1, 0, 1, 0];
const BIT_MS = 400;                  // one Manchester bit
const SAMPLE_MS = 100;               // 4-20 mA logger sample period
const PEAK = 9.20;

async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- Manchester codec (pure, also used by the self-test) ---------- */
function msgToBits(msg) {
  const bits = [...PREAMBLE];
  for (const ch of msg) for (let i = 7; i >= 0; i--) bits.push((ch.charCodeAt(0) >> i) & 1);
  return bits;
}
// IEEE 802.3: bit 1 => first half LOW then HIGH; bit 0 => HIGH then LOW.
// state 1 = pump ON (level falling); state 0 = pump OFF (level rising). HIGH == pump OFF.
function bitsToHalfStates(bits) {
  const halves = [];
  for (const b of bits) { halves.push(b ? 1 : 0); halves.push(b ? 0 : 1); } // [low,high] for 1
  return halves; // 1 => pumpON/falling for this half
}
// Decode from recorded {t, level} samples. Samples are emitted on a fixed schedule of
// SAMPLES_PER_HALF per half-bit, so we group by index (alignment-free) and read slope sign.
const SAMPLES_PER_HALF = (BIT_MS / 2) / SAMPLE_MS;
function decodeSamples(samples) {
  const halves = [];
  for (let k = 0; (k + 1) * SAMPLES_PER_HALF <= samples.length; k++) {
    const chunk = samples.slice(k * SAMPLES_PER_HALF, (k + 1) * SAMPLES_PER_HALF);
    const slope = chunk[chunk.length - 1].level - chunk[0].level;
    halves.push(slope < 0 ? 1 : 0); // falling => pump ON => state 1
  }
  const bits = [];
  for (let i = 0; i + 1 < halves.length; i += 2) bits.push(halves[i] === 1 && halves[i + 1] === 0 ? 1 : 0);
  // drop preamble
  const body = bits.slice(PREAMBLE.length);
  let out = "";
  for (let i = 0; i + 8 <= body.length; i += 8) {
    let c = 0; for (let j = 0; j < 8; j++) c = (c << 1) | body[i + j];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}
export const _test = { msgToBits, bitsToHalfStates, decodeSamples, BIT_MS, SAMPLE_MS };

/* ---------- UI ---------- */
export function mount(root, ctx) {
  injectCSS();
  const tank = new WaterTank({ level: 5.0 });
  const st = {
    phase: "idle", connected: false, sisOff: false, armed: false,
    inflow: 0, pumpCmd: false, hmiLevel: 5.0, hmiP2: false,
    halves: [], txTick: 0, samples: [], txDone: false, revealed: false,
  };

  const term = h("div", { class: "sim-term", id: "cc-term" });
  const line = (t, cls) => { const d = h("div", cls ? { class: cls } : {}, t); term.appendChild(d); term.scrollTop = term.scrollHeight; };
  const input = h("input", { class: "sim-input", style: "width:100%", placeholder: "type 'help' and press Enter", spellcheck: "false", autocomplete: "off" });

  // HMI panel
  const hmiLvl = h("b", { id: "cc-hmilvl", text: "5.00 m" });
  const trueLvl = h("b", { id: "cc-truelvl", text: "5.00 m" });
  const p2led = led(false);
  const statusEl = h("b", { id: "cc-status", text: "NOMINAL" });
  const bar = h("div", { class: "sim-bar" }, [h("i", { id: "cc-bar", style: "width:0%" })]);
  const hmi = panel("HMI-01 (operator view)", [
    kv("Displayed level", hmiLvl),
    kv("Pump P-2", h("span", {}, [p2led, h("span", { id: "cc-p2txt", text: " ---" })])),
    kv("Status", statusEl),
    h("div", { class: "sim-dim", text: "true level (forensic):" }), bar, kv("", trueLvl),
  ]);
  const consolePanel = panel("Recovered Attacker Console", [term, h("div", { class: "sim-row" }, [input])]);

  root.appendChild(h("div", { class: "sim-wrap" }, [h("div", { class: "sim-grid" }, [hmi, consolePanel])]));

  line("blackwood implant shell v0.9  (sandbox)");
  line("sequence: connect --src <ip> | sis inhibit <word> | implant arm <cfg> | modbus write 0 500 | history | log | decode", "sim-dim");

  async function handle(raw) {
    const cmd = raw.trim(); if (!cmd) return;
    line("$ " + cmd);
    const a = cmd.split(/\s+/);
    if (a[0] === "help") { line("connect --src <ip>; sis inhibit <hexword>; implant arm <cfg>; modbus write 0 500; history; log; decode; status"); return; }
    if (a[0] === "status") { line(`phase=${st.phase} connected=${st.connected} sis_off=${st.sisOff} armed=${st.armed} true=${tank.level.toFixed(2)}m`); return; }
    if (a[0] === "connect") {
      const i = a.indexOf("--src"); const ip = i >= 0 ? a[i + 1] : "";
      if ((await sha256hex((ip || "").trim())) === C1_IP_HASH) { st.connected = true; line("connected, spoofing source " + ip, "sim-ok"); }
      else line("refused: --src must be the real C1 source address", "sim-bad");
      return;
    }
    if (a[0] === "sis" && a[1] === "inhibit") {
      if (!st.connected) return line("refused: connect first", "sim-bad");
      const w = (a[2] || "").toLowerCase().replace(/^0x/, "");
      if (parseInt(w, 16) === C3_WORD) { st.sisOff = true; line("SIS inhibited via diag word 0x7A4F (no mismatch alarm)", "sim-ok"); }
      else line("refused: wrong diagnostic word (see C3)", "sim-bad");
      return;
    }
    if (a[0] === "implant" && a[1] === "arm") {
      if (!st.sisOff) return line("refused: inhibit the SIS first", "sim-bad");
      const cfg = a.slice(2).join(" ").trim();
      if ((await sha256hex(cfg)) === C4_CFG_HASH) { st.armed = true; line("implant armed with backdoor config (from C4)", "sim-ok"); }
      else line("refused: config does not match the %DB99 backdoor", "sim-bad");
      return;
    }
    if (a[0] === "modbus" && a[1] === "write") {
      if (!st.armed) return line("refused: arm the implant first", "sim-bad");
      const reg = +a[2], val = +a[3];
      if (reg === 0) { st.inflow = (val || 0) / 1000; st.pumpCmd = false; line(`inlet setpoint = ${st.inflow.toFixed(3)} m3/s, pump stopped; spoofing HMI flat`, "sim-ok"); st.phase = "driving"; }
      else line(`wrote HR${reg}=${val}`);
      return;
    }
    if (a[0] === "history") {
      line("step  t(s)  pump  dLevel  note");
      line(" 1     00    OFF   +0.40   inflow 0.50, pump off");
      line(" 2     10    OFF   +0.40   inflow 0.50, pump off");
      line(" 3     20    ON    +0.39   <-- pump ON yet level still RISING fast", "sim-bad");
      line(" 4     30    OFF   +0.40   inflow 0.50, pump off");
      line("note: step 3 violates mass balance (pump ON must subtract 0.28 m3/s) => spoofed row", "sim-dim");
      return;
    }
    if (a[0] === "log") {
      if (!st.samples.length) return line("no transmission captured yet (drive to peak and wait for the last transmission)", "sim-bad");
      line(`captured ${st.samples.length} samples @ ${SAMPLE_MS} ms  (t_ms, mA, level_m)`);
      const span = Math.max(1, Math.floor(st.samples.length / 40));
      for (let i = 0; i < st.samples.length; i += span) {
        const s = st.samples[i];
        line(`${String(s.t).padStart(6)}  ${s.mA.toFixed(3)}  ${s.level.toFixed(4)}`);
      }
      return;
    }
    if (a[0] === "decode") {
      if (!st.txDone) return line("transmission not finished yet", "sim-bad");
      const msg = decodeSamples(st.samples);
      line("manchester decode -> " + JSON.stringify(msg), "sim-ok");
      if (msg && !st.revealed) { st.revealed = true; ctx.onReveal(msg); }
      return;
    }
    line("unknown command: " + a[0], "sim-bad");
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const v = input.value; input.value = ""; handle(v); } });

  // physics + transmission loop
  let last = performance.now();
  const startTx = () => {
    st.phase = "transmit";
    st.halves = bitsToHalfStates(msgToBits(MESSAGE));
    st.txTick = 0; st.samples = [];
    tank.level = 5.0; // keep the covert signal mid-span so slopes never clamp
    st.hmiP2 = true; // lamp forced steady ON (the lie)
    line("!! HMI LOCKED. P2 shows steady ON. implant transmitting...", "sim-bad");
  };
  const tick = () => {
    if (!document.body.contains(root)) { clearInterval(iv); return; }
    const now = performance.now(), dt = (now - last) / 1000; last = now;

    if (st.phase === "driving") {
      tank.inflow = st.inflow; tank.outflow = st.pumpCmd ? 0.28 : 0.0;
      tank.step(dt);
      st.hmiLevel = 5.0; // spoofed flat
      if (tank.level >= PEAK) startTx();
    } else if (st.phase === "transmit") {
      // Fixed-schedule emission: SAMPLES_PER_HALF samples per half-bit, tick-indexed.
      const halfIdx = Math.floor(st.txTick / SAMPLES_PER_HALF);
      if (halfIdx >= st.halves.length) {
        st.phase = "txdone"; st.txDone = true; tank.inflow = tank.outflow = 0;
        line("transmission complete. run 'log' then 'decode'.", "sim-ok");
      } else {
        const stateOn = st.halves[halfIdx] === 1; // pump ON => level falling
        tank.inflow = stateOn ? 0.10 : 0.50; tank.outflow = stateOn ? 0.50 : 0.10;
        tank.step(SAMPLE_MS / 1000); // fixed step so slope sign is clean
        st.samples.push({ t: st.txTick * SAMPLE_MS, level: tank.level, mA: tank.toMilliamps() });
        st.txTick++;
        st.hmiLevel = 5.0; st.hmiP2 = true;
      }
    }

    // paint
    document.getElementById("cc-hmilvl").textContent = st.hmiLevel.toFixed(2) + " m";
    document.getElementById("cc-truelvl").textContent = tank.level.toFixed(2) + " m";
    document.getElementById("cc-bar").style.width = Math.min(100, (tank.level / PEAK) * 100) + "%";
    const p2on = st.phase === "transmit" || st.phase === "txdone" ? true : st.pumpCmd;
    p2led.className = "sim-led" + (st.hmiP2 || p2on ? " on" : "");
    document.getElementById("cc-p2txt").textContent = st.hmiP2 ? " ON (steady)" : (p2on ? " ON" : " OFF");
    document.getElementById("cc-status").textContent =
      st.phase === "idle" ? "NOMINAL" : st.phase === "driving" ? "FILLING (HMI spoofed)" :
      st.phase === "transmit" ? "HMI LOCKED / EXFIL" : st.phase === "txdone" ? "EXFIL CAPTURED" : "ACTIVE";
    document.getElementById("cc-status").className = st.phase === "transmit" ? "sim-bad" : "sim-ok";
  };
  const iv = setInterval(tick, SAMPLE_MS);
  tick();
}
