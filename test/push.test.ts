import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash, generateKeyPairSync, verify, createPublicKey } from "node:crypto";
import { assinar, chavePublica, chavePrivadaDe, naCurva, bytesParaBigInt } from "../src/push/p256.ts";
import { cabecalhoVapid, base64url, deBase64url } from "../src/push/vapid.ts";

const hmac = (k: Uint8Array, d: Uint8Array) => new Uint8Array(createHmac("sha256", k).update(d).digest());
const sha256 = (d: Uint8Array) => new Uint8Array(createHash("sha256").update(d).digest());

test("chave pública bate com a do Node e está na curva", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string; y: string };
  const pub = chavePublica(deBase64url(jwk.d));
  assert.equal(pub[0], 4);
  assert.equal(base64url(pub.slice(1, 33)), jwk.x);
  assert.equal(base64url(pub.slice(33, 65)), jwk.y);
  assert.ok(naCurva({ x: bytesParaBigInt(pub.slice(1, 33)), y: bytesParaBigInt(pub.slice(33)) }));
});

test("assinatura ES256 é verificada pelo Node (ieee-p1363) e é determinística", () => {
  const priv = chavePrivadaDe(sha256(new TextEncoder().encode("semente de teste")));
  const pub = chavePublica(priv);
  const msg = new TextEncoder().encode("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJ4In0");
  const sig = assinar(sha256(msg), priv, hmac);
  const chave = createPublicKey({ key: { kty: "EC", crv: "P-256", x: base64url(pub.slice(1, 33)), y: base64url(pub.slice(33)) }, format: "jwk" });
  assert.equal(verify("sha256", msg, { key: chave, dsaEncoding: "ieee-p1363" }, sig), true);
  assert.deepEqual([...assinar(sha256(msg), priv, hmac)], [...sig]);
  // outra mensagem não confere
  assert.equal(verify("sha256", new TextEncoder().encode("outra"), { key: chave, dsaEncoding: "ieee-p1363" }, sig), false);
});

test("cabeçalho VAPID: aud = origem do endpoint, JWT válido, k = chave pública", () => {
  const priv = chavePrivadaDe(sha256(new TextEncoder().encode("vapid")));
  const h = cabecalhoVapid("https://fcm.googleapis.com/fcm/send/abc123", "mailto:fazenda@exemplo.com", priv, hmac, sha256, Date.parse("2026-02-08T12:00:00Z"));
  const m = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(h.Authorization)!;
  assert.ok(m, h.Authorization);
  const [cab, corpo, sig] = m[1]!.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(deBase64url(cab!)).toString()), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(deBase64url(corpo!)).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:fazenda@exemplo.com");
  assert.equal(claims.exp, Math.floor(Date.parse("2026-02-08T12:00:00Z") / 1000) + 12 * 3600);
  const pub = deBase64url(m[2]!);
  const chave = createPublicKey({ key: { kty: "EC", crv: "P-256", x: base64url(pub.slice(1, 33)), y: base64url(pub.slice(33)) }, format: "jwk" });
  assert.equal(verify("sha256", Buffer.from(cab + "." + corpo), { key: chave, dsaEncoding: "ieee-p1363" }, deBase64url(sig!)), true);
});
