// Local progress store: persists solved status in IndexedDB / localStorage.
const DB_NAME = "blackwood_ctf";
const DB_VER = 1;
let _db = null;
let _idbOk = true;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
function idbGet(key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const r = db.transaction("meta", "readonly").objectStore("meta").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
function idbSet(key, val) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function lsGet(key) { try { const v = localStorage.getItem("bkw_meta_" + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; } }
function lsSet(key, val) { try { localStorage.setItem("bkw_meta_" + key, JSON.stringify(val)); } catch {} }

async function get(key) {
  if (_idbOk) { try { return await idbGet(key); } catch { _idbOk = false; } }
  return lsGet(key);
}
async function set(key, val) {
  if (_idbOk) { try { await idbSet(key, val); return; } catch { _idbOk = false; } }
  lsSet(key, val);
}

export async function loadSolved() {
  const s = await get("solved");
  return Array.isArray(s) ? s : [];
}
export async function saveSolved(solved) {
  await set("solved", [...solved]);
}

// Revealed flags (so a solved challenge can re-show its decrypted flag on reload).
export async function loadFlags() {
  const f = await get("flags");
  return f && typeof f === "object" ? f : {};
}
export async function saveFlags(flags) {
  await set("flags", flags);
}
