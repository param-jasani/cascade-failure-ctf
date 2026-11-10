import { loadSolved, saveSolved, loadFlags, saveFlags } from "./store.js";
import { normalizeAnswer, deriveAndDecrypt } from "./crypto.js";

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let DATA = null;
let STORY = null;
let SOLVED = new Set();
let FLAGS = {}; // id -> decrypted flag string

/* ---------------- scoring ---------------- */
const isChallengeSolved = (c) => SOLVED.has(c.id);
const challengeMaxPoints = (c) => c.points || 0;
const maxPoints = () => DATA.challenges.reduce((a, c) => a + challengeMaxPoints(c), 0);
const points = () => DATA.challenges.reduce((a, c) => a + (isChallengeSolved(c) ? challengeMaxPoints(c) : 0), 0);
const diff = (d) => (d || "").toLowerCase().replace(/[^a-z]/g, "");

function renderScore() {
  const box = el("score");
  if (box) box.innerHTML = `${points()}<small>/${maxPoints()} pts</small>`;
}
async function markSolved(id, flag) {
  SOLVED.add(id);
  if (flag) FLAGS[id] = flag;
  await saveSolved(SOLVED);
  await saveFlags(FLAGS);
  renderScore();
}

/* ---------------- story navigation (UNGATED) ----------------
   Every chapter and the epilogue are readable from the start; solving only scores
   points and reveals that chapter's flag. Nothing is locked. */
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const chapterNo = (c) => DATA.challenges.indexOf(c) + 1;
const chapterStory = (c) => (STORY.chapters && STORY.chapters[c.id]) || {};
const phaseOf = (c) => DATA.phases.find((p) => p.id === c.phase) || { id: c.phase, name: "" };
const storyComplete = () => DATA.challenges.every(isChallengeSolved);
const currentChapter = () => DATA.challenges.find((c) => !isChallengeSolved(c)) || null;
function continueHref() {
  const cur = currentChapter();
  return cur ? `#/challenge/${cur.id}` : "#/epilogue";
}

/* ---------------- home / dossier ---------------- */
function viewHome() {
  const cur = currentChapter();
  const acts = DATA.phases.map((ph) => {
    const ch = DATA.challenges.filter((c) => c.phase === ph.id);
    if (!ch.length) return "";
    const rows = ch.map((c) => {
      const n = chapterNo(c), solved = isChallengeSolved(c);
      const state = solved ? "solved" : (c === cur ? "current" : "open");
      const mark = { solved: "✓", current: "▶", open: "▷" }[state];
      const meta = `<span class="toc-meta">${esc(c.category)} · <span class="tag tag-${diff(c.difficulty)}">${esc(c.difficulty)}</span> · ${challengeMaxPoints(c)} pts</span>`;
      return `<li class="toc-row toc-${state}"><span class="toc-mark" aria-hidden="true">${mark}</span>
        <a class="toc-name" href="#/challenge/${c.id}">Chapter ${n}: ${esc(c.name)}</a>${meta}</li>`;
    }).join("");
    return `<section class="toc-act">
      <div class="toc-act-head"><span class="tag bg-ink text-white">Act ${ROMAN[ph.id] || ph.id}</span>
        <span class="toc-act-name">${esc(ph.name)}</span></div>
      <ol class="toc-list">${rows}</ol>
    </section>`;
  }).join("");
  const done = DATA.challenges.filter(isChallengeSolved).length;
  const finale = `<li class="toc-row ${storyComplete() ? "toc-solved" : "toc-open"}"><span class="toc-mark" aria-hidden="true">★</span>
    <a class="toc-name" href="#/epilogue">Epilogue: ${esc(STORY.finale.title)}</a>
    <span class="toc-meta">${storyComplete() ? "case closed" : "readable anytime"}</span></li>`;
  return `
    <article class="chapter">
      <div class="chapter-head">
        <div class="chapter-act">The Incident Dossier · ${esc(DATA.event.subtitle)}</div>
        <h1 class="chapter-title">${esc(DATA.event.name)}</h1>
      </div>
      <p class="chapter-when">Prologue · flag format ${esc(DATA.event.flag_format)} · verification ${esc((DATA.verify && DATA.verify.scheme) || "")}</p>
      <div class="chapter-prose"><p>${esc(STORY.intro)}</p></div>
    </article>
    <p class="chapter-when text-center">${done} of ${DATA.challenges.length} chapters solved · ${points()} of ${maxPoints()} points · the whole story is open to read</p>
    <div class="toc mt-6">${acts}
      <section class="toc-act"><ol class="toc-list">${finale}</ol></section>
    </div>
    <div class="mt-6 flex flex-wrap justify-center gap-3">
      <a href="${continueHref()}" class="btn-primary no-underline">${done ? "Continue the investigation →" : "Begin the investigation →"}</a>
      ${SOLVED.size ? `<button class="btn-secondary" id="reset">Reset progress</button>` : ""}
    </div>
    <p class="font-mono text-[11px] text-gray-400 text-center mt-3">Progress is saved in this browser only. Flags are never shipped in plaintext — your answer decrypts them.</p>`;
}

function wireHome() {
  const reset = el("reset");
  if (!reset) return;
  reset.addEventListener("click", async () => {
    if (!window.confirm("Reset all progress in this browser?")) return;
    SOLVED = new Set(); FLAGS = {};
    await saveSolved(SOLVED); await saveFlags(FLAGS);
    renderScore(); render();
  });
}

/* ---------------- epilogue ---------------- */
function viewEpilogue() {
  const f = STORY.finale;
  const note = storyComplete()
    ? ""
    : `<div class="notestrip mb-4">You are reading ahead — not every chapter is solved yet. Points accrue as you solve, but the story is yours to read anytime. <a href="${continueHref()}">Jump back to where you are →</a></div>`;
  return `
    <a href="#/" class="btn-secondary no-underline">← Incident Dossier</a>
    <article class="chapter mt-4">
      <div class="chapter-head"><div class="chapter-act">Epilogue</div><h1 class="chapter-title">${esc(f.title)}</h1></div>
      <p class="chapter-when">${esc(f.when)}</p>
      ${note}
      <div class="chapter-prose">${f.text}</div>
      <nav class="chapter-paths" aria-label="Where next"><ul>
        <li><a href="#/">The incident dossier (all chapters)</a></li>
      </ul></nav>
    </article>`;
}

/* ---------------- chapter detail ---------------- */
function chapterAfterHTML(c) {
  const i = DATA.challenges.indexOf(c), prev = DATA.challenges[i - 1], next = DATA.challenges[i + 1];
  const solved = isChallengeSolved(c), st = chapterStory(c);
  const ending = solved && st.close ? `<div class="chapter-prose chapter-ending">${st.close}</div>` : "";
  const items = [];
  if (next) items.push(`<li class="chapter-next"><a href="#/challenge/${next.id}">Chapter ${i + 2}: ${esc(next.name)} →</a></li>`);
  else items.push(`<li class="chapter-next"><a href="#/epilogue">Epilogue: ${esc(STORY.finale.title)} →</a></li>`);
  if (prev) items.push(`<li><a href="#/challenge/${prev.id}">← Chapter ${i}: ${esc(prev.name)}</a></li>`);
  items.push(`<li><a href="#/">The incident dossier (all chapters)</a></li>`);
  return `${ending}<nav class="chapter-paths" aria-label="Where next"><ul>${items.join("")}</ul></nav>`;
}

function submitHTML(c) {
  const solved = isChallengeSolved(c);
  const shown = solved && FLAGS[c.id]
    ? `<div class="result-ok">[OK] ${esc(FLAGS[c.id])}</div>`
    : (solved ? `<div class="result-ok">[OK] Chapter solved.</div>` : "");
  return `
    <div class="mt-8 border-t-2 border-ink pt-5">
      <div class="label">Submit recovered answer</div>
      <div class="notestrip mb-3">${esc(c.answer_label || "Your answer")} — a correct value decrypts and reveals the <span class="inline-code">${esc(c.flag_format)}</span> flag.</div>
      <div class="flex flex-col sm:flex-row gap-3">
        <input id="flaginput" class="input flex-1" maxlength="120" placeholder="${esc(c.answer_placeholder || "")}" autocomplete="off" spellcheck="false" ${solved ? "disabled" : ""}>
        <button class="btn-primary" id="flagbtn" ${solved ? "disabled" : ""}>Decrypt &amp; Verify</button>
      </div>
      <div id="flagresult" class="mt-2">${shown}</div>
    </div>`;
}

function viewDetail(id) {
  const c = DATA.challenges.find((x) => x.id === id);
  if (!c) return `<a href="#/" class="btn-secondary no-underline">← Incident Dossier</a><p class="mt-4">Unknown chapter.</p>`;
  const solved = isChallengeSolved(c);
  const st = chapterStory(c), ph = phaseOf(c);
  const assets = (c.assets || []).length
    ? `<div class="label mt-6">Artifacts</div><div class="flex flex-wrap gap-2">${c.assets.map((a) => `<a class="btn-secondary no-underline" href="${esc(a.path)}" download>↓ ${esc(a.name)}</a>`).join("")}</div>` : "";
  const sim = c.mode === "sim" ? `<div class="label mt-6">Live simulator</div><div id="sim-root" class="sim-root">Loading simulator…</div>` : "";
  const hints = (c.hints || []).length
    ? `<div class="label mt-6">Investigation Hints</div>${c.hints.map((h, i) => `<details class="hint"><summary>Hint ${i + 1}</summary><div class="hint-body">${h}</div></details>`).join("")}` : "";

  return `
    <a href="#/" class="btn-secondary no-underline">← Incident Dossier</a>
    <article class="chapter mt-4">
      <div class="chapter-head">
        <div class="chapter-act">Act ${ROMAN[ph.id] || ph.id} · ${esc(ph.name)}</div>
        <h1 class="chapter-title">Chapter ${chapterNo(c)}: ${esc(c.name)}</h1>
      </div>
      ${st.when ? `<p class="chapter-when">${esc(st.when)}</p>` : ""}
      ${st.open ? `<div class="chapter-prose">${st.open}</div>` : ""}
      <div class="card chapter-task">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="tag bg-ink text-white">${c.mode === "sim" ? "Live Exercise" : "Forensic Task"}</span>
          <span class="tag bg-white">${esc(c.category)}</span>
          <span class="tag tag-${diff(c.difficulty)}">${esc(c.difficulty)}</span>
          <span class="tag bg-white">${challengeMaxPoints(c)} PTS</span>
          ${solved ? '<span class="tag tag-easy">✓ SOLVED</span>' : ""}
        </div>
        <div class="desc text-gray-800">${c.description}</div>
        ${assets}
        ${sim}
        ${hints}
        ${submitHTML(c)}
      </div>
      <div id="chapter-after">${chapterAfterHTML(c)}</div>
    </article>`;
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-ink text-white font-mono text-sm px-4 py-3 border-2 border-ink shadow-[4px_4px_0_0_#5ce1e6]";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

async function wireDetail(id) {
  const c = DATA.challenges.find((x) => x.id === id);
  if (!c) return;

  // Mount the live simulator for web challenges.
  if (c.mode === "sim" && c.sim) {
    const root = el("sim-root");
    try {
      const mod = await import(`./sim/${c.sim}.js`);
      root.innerHTML = "";
      mod.mount(root, {
        challenge: c,
        // A sim calls onReveal(answerString) when the player recovers the canonical answer.
        onReveal: (answer) => {
          const input = el("flaginput");
          if (input && !input.disabled) {
            input.value = answer;
            input.focus();
            toast("Canonical answer recovered — press Decrypt & Verify.");
          }
        },
      });
    } catch (e) {
      root.innerHTML = `<div class="result-bad">Failed to load simulator: ${esc(String(e))}</div>`;
    }
  }

  const input = el("flaginput"), btn = el("flagbtn"), res = el("flagresult");
  if (!input || !btn) return;
  const submit = async () => {
    const raw = input.value;
    if (!raw.trim()) return;
    btn.disabled = true;
    res.innerHTML = '<span class="font-mono text-xs text-gray-500">Deriving key (PBKDF2 600k) and decrypting…</span>';
    let flag = null;
    try { flag = await deriveAndDecrypt(normalizeAnswer(c.answer_kind, raw), c.enc); } catch { flag = null; }
    if (flag && /^HXN\{/.test(flag)) {
      input.disabled = true;
      res.innerHTML = `<div class="result-ok animate-slide-in">[OK] Flag decrypted: ${esc(flag)}</div>`;
      await markSolved(c.id, flag);
      const after = el("chapter-after");
      if (after) { after.innerHTML = chapterAfterHTML(c); }
      if (storyComplete()) toast("🏁 Every chapter solved — the epilogue is open.");
    } else {
      btn.disabled = false;
      res.innerHTML = '<div class="result-bad animate-shake">[DENIED] Wrong answer — the authentication tag failed. Re-examine the evidence.</div>';
    }
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

/* ---------------- router ---------------- */
function render() {
  const hash = location.hash || "#/";
  const app = el("app");
  if (hash.startsWith("#/challenge/")) {
    const id = hash.slice("#/challenge/".length);
    app.innerHTML = viewDetail(id); wireDetail(id);
  } else if (hash === "#/epilogue") { app.innerHTML = viewEpilogue(); }
  else { app.innerHTML = viewHome(); wireHome(); }
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", hash === "#/" || hash === ""));
  app.classList.remove("animate-slide-in"); void app.offsetWidth; app.classList.add("animate-slide-in");
  window.scrollTo(0, 0);
}

async function boot() {
  [DATA, STORY] = await Promise.all([
    fetch("data/challenges.json").then((r) => r.json()),
    fetch("data/story.json").then((r) => r.json()),
  ]);
  [SOLVED, FLAGS] = [new Set(await loadSolved()), await loadFlags()];
  renderScore();
  window.addEventListener("hashchange", render);
  render();
}
boot();
