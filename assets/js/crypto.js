// Browser-side flag verification for Cascade Failure.
// Mirrors data/crypto_common.py + data/build_blobs.py exactly:
//   key = PBKDF2-SHA256(normalize(answer), salt, 600000) -> AES-256-GCM decrypt(ct, iv)
// A correct canonical answer decrypts to the HXN{...} flag; a wrong one fails the GCM tag.

const ITER = 600000;

// Keep behavior byte-for-byte identical to crypto_common.normalize().
export function normalizeAnswer(kind, raw) {
  const s = (raw == null ? "" : String(raw)).trim();
  if (kind === "lower") return s.toLowerCase();
  if (kind === "decimal2") {
    const n = Number(s);
    return Number.isFinite(n) ? n.toFixed(2) : "\u0000bad-decimal";
  }
  if (kind === "ip") {
    const oct = s.split(".");
    if (oct.length !== 4) return "\u0000bad-ip";
    if (!oct.every((o) => /^\d+$/.test(o.trim()) && +o >= 0 && +o <= 255)) return "\u0000bad-ip";
    return oct.map((o) => parseInt(o, 10)).join(".");
  }
  return s;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Returns the decrypted flag string, or null if the answer is wrong (GCM tag failure).
export async function deriveAndDecrypt(normalizedAnswer, enc) {
  const subtle = crypto.subtle;
  const salt = b64ToBytes(enc.salt), iv = b64ToBytes(enc.iv), ct = b64ToBytes(enc.ct);
  const baseKey = await subtle.importKey(
    "raw", new TextEncoder().encode(normalizedAnswer), "PBKDF2", false, ["deriveKey"]
  );
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  try {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// Convenience: normalize + decrypt in one call.
export async function verifyAnswer(rawAnswer, kind, enc) {
  return deriveAndDecrypt(normalizeAnswer(kind, rawAnswer), enc);
}
