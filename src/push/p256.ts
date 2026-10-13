/**
 * Curva P-256 (secp256r1) em BigInt, só o necessário para o VAPID do Web Push: chave pública a partir
 * da privada e assinatura ECDSA (ES256) com k determinístico (RFC 6979). O Apps Script (V8) não tem
 * WebCrypto, então isto roda lá; o SHA-256 e o HMAC vêm de fora (Utilities no Apps Script, crypto no Node).
 */
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const A = P - 3n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

type Ponto = { x: bigint; y: bigint } | null;   // null = infinito

const mod = (a: bigint, m = P): bigint => ((a % m) + m) % m;
function modInv(a: bigint, m = P): bigint {
  let [g, x, x1, b] = [mod(a, m), 1n, 0n, m];
  while (b !== 0n) { const q = g / b; [g, b] = [b, g - q * b]; [x, x1] = [x1, x - q * x1]; }
  if (g !== 1n) throw new Error("sem inverso");
  return mod(x, m);
}
function soma(p: Ponto, q: Ponto): Ponto {
  if (!p) return q; if (!q) return p;
  if (p.x === q.x) { if (mod(p.y + q.y) === 0n) return null; return dobra(p); }
  const l = mod((q.y - p.y) * modInv(q.x - p.x));
  const x = mod(l * l - p.x - q.x);
  return { x, y: mod(l * (p.x - x) - p.y) };
}
function dobra(p: Ponto): Ponto {
  if (!p) return null;
  const l = mod((3n * p.x * p.x + A) * modInv(2n * p.y));
  const x = mod(l * l - 2n * p.x);
  return { x, y: mod(l * (p.x - x) - p.y) };
}
function mult(k: bigint, p: Ponto): Ponto {
  let r: Ponto = null, q = p;
  while (k > 0n) { if (k & 1n) r = soma(r, q); q = dobra(q); k >>= 1n; }
  return r;
}
export function naCurva(p: { x: bigint; y: bigint }): boolean {
  return mod(p.y * p.y - (p.x * p.x * p.x + A * p.x + B)) === 0n;
}

export const bytesParaBigInt = (b: Uint8Array): bigint => b.reduce((t, v) => (t << 8n) | BigInt(v), 0n);
export function bigIntParaBytes(n: bigint, tam = 32): Uint8Array {
  const out = new Uint8Array(tam);
  for (let i = tam - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}

/** Chave pública (ponto descomprimido, 65 bytes: 0x04 ‖ X ‖ Y) a partir da privada (32 bytes). */
export function chavePublica(privada: Uint8Array): Uint8Array {
  const d = bytesParaBigInt(privada);
  if (d <= 0n || d >= N) throw new Error("chave privada fora da faixa");
  const q = mult(d, { x: GX, y: GY })!;
  const out = new Uint8Array(65); out[0] = 4; out.set(bigIntParaBytes(q.x), 1); out.set(bigIntParaBytes(q.y), 33);
  return out;
}

/** Chave privada válida a partir de 32+ bytes aleatórios (reduz módulo n−1 e soma 1). */
export function chavePrivadaDe(aleatorio: Uint8Array): Uint8Array {
  return bigIntParaBytes((bytesParaBigInt(aleatorio) % (N - 1n)) + 1n);
}

export type Hmac = (chave: Uint8Array, dados: Uint8Array) => Uint8Array;

/** k determinístico (RFC 6979, SHA-256) — sem depender de aleatoriedade boa no Apps Script. */
function kDeterministico(hash: Uint8Array, d: bigint, hmac: Hmac): bigint {
  const x = bigIntParaBytes(d), h1 = hash.slice(0, 32);
  let v: Uint8Array = new Uint8Array(32).fill(1), k: Uint8Array = new Uint8Array(32);
  const cat = (...p: Uint8Array[]) => { const t = new Uint8Array(p.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of p) { t.set(a, o); o += a.length; } return t; };
  k = hmac(k, cat(v, new Uint8Array([0]), x, h1)); v = hmac(k, v);
  k = hmac(k, cat(v, new Uint8Array([1]), x, h1)); v = hmac(k, v);
  for (;;) {
    v = hmac(k, v);
    const cand = bytesParaBigInt(v);
    if (cand > 0n && cand < N) return cand;
    k = hmac(k, cat(v, new Uint8Array([0]))); v = hmac(k, v);
  }
}

/** Assinatura ECDSA do hash (SHA-256 da mensagem), formato cru r‖s (64 bytes), como o JWS ES256 pede. */
export function assinar(hash: Uint8Array, privada: Uint8Array, hmac: Hmac): Uint8Array {
  const d = bytesParaBigInt(privada), z = bytesParaBigInt(hash.slice(0, 32)) % N;
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const k = kDeterministico(hash, d + BigInt(tentativa), hmac);
    const p = mult(k, { x: GX, y: GY })!;
    const r = p.x % N; if (r === 0n) continue;
    let s = mod(modInv(k, N) * (z + r * d), N); if (s === 0n) continue;
    if (s > N / 2n) s = N - s;   // forma baixa (aceita em todo lugar)
    const out = new Uint8Array(64); out.set(bigIntParaBytes(r), 0); out.set(bigIntParaBytes(s), 32);
    return out;
  }
  throw new Error("não consegui assinar");
}
