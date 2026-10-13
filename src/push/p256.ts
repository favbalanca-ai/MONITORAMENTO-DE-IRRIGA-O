/**
 * Curva P-256 (secp256r1) em BigInt, só o necessário para o VAPID do Web Push: chave pública a partir
 * da privada e assinatura ECDSA (ES256) com k determinístico (RFC 6979). O Apps Script (V8) não tem
 * WebCrypto, então isto roda lá; o SHA-256 e o HMAC vêm de fora (Utilities no Apps Script, crypto no Node).
 */
// Sem literais BigInt com sufixo n: o editor do Apps Script não os aceita, embora o V8 dele suporte BigInt.
const _0 = BigInt(0), _1 = BigInt(1), _2 = BigInt(2), _3 = BigInt(3), _8 = BigInt(8), _255 = BigInt(255);
const P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const A = P - _3;
const B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
const GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
const GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");

type Ponto = { x: bigint; y: bigint } | null;   // null = infinito

const mod = (a: bigint, m = P): bigint => ((a % m) + m) % m;
function modInv(a: bigint, m = P): bigint {
  let [g, x, x1, b] = [mod(a, m), _1, _0, m];
  while (b !== _0) { const q = g / b; [g, b] = [b, g - q * b]; [x, x1] = [x1, x - q * x1]; }
  if (g !== _1) throw new Error("sem inverso");
  return mod(x, m);
}
function soma(p: Ponto, q: Ponto): Ponto {
  if (!p) return q; if (!q) return p;
  if (p.x === q.x) { if (mod(p.y + q.y) === _0) return null; return dobra(p); }
  const l = mod((q.y - p.y) * modInv(q.x - p.x));
  const x = mod(l * l - p.x - q.x);
  return { x, y: mod(l * (p.x - x) - p.y) };
}
function dobra(p: Ponto): Ponto {
  if (!p) return null;
  const l = mod((_3 * p.x * p.x + A) * modInv(_2 * p.y));
  const x = mod(l * l - _2 * p.x);
  return { x, y: mod(l * (p.x - x) - p.y) };
}
function mult(k: bigint, p: Ponto): Ponto {
  let r: Ponto = null, q = p;
  while (k > _0) { if (k & _1) r = soma(r, q); q = dobra(q); k >>= _1; }
  return r;
}
export function naCurva(p: { x: bigint; y: bigint }): boolean {
  return mod(p.y * p.y - (p.x * p.x * p.x + A * p.x + B)) === _0;
}

export const bytesParaBigInt = (b: Uint8Array): bigint => b.reduce((t, v) => (t << _8) | BigInt(v), _0);
export function bigIntParaBytes(n: bigint, tam = 32): Uint8Array {
  const out = new Uint8Array(tam);
  for (let i = tam - 1; i >= 0; i--) { out[i] = Number(n & _255); n >>= _8; }
  return out;
}

/** Chave pública (ponto descomprimido, 65 bytes: 0x04 ‖ X ‖ Y) a partir da privada (32 bytes). */
export function chavePublica(privada: Uint8Array): Uint8Array {
  const d = bytesParaBigInt(privada);
  if (d <= _0 || d >= N) throw new Error("chave privada fora da faixa");
  const q = mult(d, { x: GX, y: GY })!;
  const out = new Uint8Array(65); out[0] = 4; out.set(bigIntParaBytes(q.x), 1); out.set(bigIntParaBytes(q.y), 33);
  return out;
}

/** Chave privada válida a partir de 32+ bytes aleatórios (reduz módulo n−1 e soma 1). */
export function chavePrivadaDe(aleatorio: Uint8Array): Uint8Array {
  return bigIntParaBytes((bytesParaBigInt(aleatorio) % (N - _1)) + _1);
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
    if (cand > _0 && cand < N) return cand;
    k = hmac(k, cat(v, new Uint8Array([0]))); v = hmac(k, v);
  }
}

/** Assinatura ECDSA do hash (SHA-256 da mensagem), formato cru r‖s (64 bytes), como o JWS ES256 pede. */
export function assinar(hash: Uint8Array, privada: Uint8Array, hmac: Hmac): Uint8Array {
  const d = bytesParaBigInt(privada), z = bytesParaBigInt(hash.slice(0, 32)) % N;
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const k = kDeterministico(hash, d + BigInt(tentativa), hmac);
    const p = mult(k, { x: GX, y: GY })!;
    const r = p.x % N; if (r === _0) continue;
    let s = mod(modInv(k, N) * (z + r * d), N); if (s === _0) continue;
    if (s > N / _2) s = N - s;   // forma baixa (aceita em todo lugar)
    const out = new Uint8Array(64); out.set(bigIntParaBytes(r), 0); out.set(bigIntParaBytes(s), 32);
    return out;
  }
  throw new Error("não consegui assinar");
}
