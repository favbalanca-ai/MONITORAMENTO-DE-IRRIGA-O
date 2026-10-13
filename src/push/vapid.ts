/**
 * VAPID (RFC 8292): o cabeçalho Authorization que o serviço de push (Google, Apple, Mozilla) exige
 * para entregar uma notificação. JWT assinado com ES256 pela chave privada da planilha.
 */
import { assinar, chavePublica, type Hmac } from "./p256.ts";

export type Sha256 = (dados: Uint8Array) => Uint8Array;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Base64 URL-safe sem padding, em JS puro (o Apps Script não tem btoa nem Buffer). */
export function base64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : "") + (i + 2 < b.length ? B64[n & 63]! : "");
  }
  return s;
}
export function deBase64url(s: string): Uint8Array {
  const limpo = s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of limpo) {
    const v = B64.indexOf(ch); if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return new Uint8Array(out);
}
/** UTF-8 em JS puro (o Apps Script não tem TextEncoder). */
export function utf8(t: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    let c = t.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < t.length) { c = 0x10000 + ((c - 0xd800) << 10) + (t.charCodeAt(++i) - 0xdc00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}
/** Origem (https://host) do endpoint — o `aud` do VAPID. */
export function origemDe(endpoint: string): string {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(endpoint);
  if (!m) throw new Error("endpoint de push inválido");
  return m[1]!.toLowerCase();
}

export interface CabecalhosVapid { Authorization: string; "Crypto-Key"?: string }

/**
 * Cabeçalho `Authorization: vapid t=<jwt>, k=<pública>` para um endpoint.
 * `aud` é a origem do endpoint (https://fcm.googleapis.com, https://web.push.apple.com…).
 */
export function cabecalhoVapid(endpoint: string, assunto: string, privada: Uint8Array, hmac: Hmac, sha256: Sha256, agoraMs = Date.now()): CabecalhosVapid {
  const aud = origemDe(endpoint);
  const exp = Math.floor(agoraMs / 1000) + 12 * 3600;   // máximo permitido: 24 h
  const cab = base64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = base64url(utf8(JSON.stringify({ aud, exp, sub: assunto })));
  const entrada = cab + "." + corpo;
  const sig = assinar(sha256(utf8(entrada)), privada, hmac);
  const pub = base64url(chavePublica(privada));
  return { Authorization: "vapid t=" + entrada + "." + base64url(sig) + ", k=" + pub };
}
