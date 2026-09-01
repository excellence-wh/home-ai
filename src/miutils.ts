// -----------------------------------------------------------
// 米家云 / MiIo 协议加解密与签名工具（TypeScript 移植版）
// 源：archive/home_ai/miutils.py（MIT, (C) 2020 Sammy Svensson）
// -----------------------------------------------------------
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const B64 = (buf: Uint8Array) => Buffer.from(buf).toString("base64");
const B64D = (s: string) => Buffer.from(s, "base64");
const sha1 = (...chunks: Uint8Array[]) => {
  const h = createHash("sha1");
  for (const c of chunks) h.update(c);
  return h.digest();
};
const sha256 = (...chunks: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return h.digest();
};

/** 纯 JS RC4：KSA + PRGA。与 pycryptodome 的 ARC4 逐字节一致。 */
function rc4(key: Uint8Array, data: Uint8Array, discard: number): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
  }
  let i = 0;
  j = 0;
  // 先用 discard 长度的密钥流推进内部状态
  for (let n = 0; n < discard; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
  }
  const out = new Uint8Array(data.length);
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
    out[n] = data[n] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

/** 生成 nonce：8 字节随机数 + floor(ms/60000) 的最小大端字节，base64。 */
export function genNonce(now: number = Date.now()): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const part2 = Math.floor(now / 60000);
  // part2 的最小大端字节
  const pbytes: number[] = [];
  let p = part2;
  if (p === 0) pbytes.push(0);
  while (p > 0) {
    pbytes.unshift(p & 0xff);
    p = Math.floor(p / 256);
  }
  const combined = new Uint8Array(8 + pbytes.length);
  combined.set(b, 0);
  combined.set(pbytes, 8);
  return B64(combined);
}

/** signed_nonce = base64( sha256( base64d(ssecret) + base64d(nonce) ) ) */
export function getSignedNonce(ssecret: string, nonce: string): string {
  return B64(sha256(B64D(ssecret), B64D(nonce)));
}

/** 生成加密签名（sha1），params 保持传入顺序。 */
export function genEncSignature(
  uri: string,
  method: string,
  signedNonce: string,
  params: Record<string, string>,
): string {
  const parts: string[] = [method.toUpperCase(), uri];
  for (const [k, v] of Object.entries(params)) parts.push(`${k}=${v}`);
  parts.push(signedNonce);
  return B64(sha1(Buffer.from(parts.join("&"), "utf8")));
}

/** 生成最终加密请求参数（原位修改并返回）。 */
export function generateEncParams(
  uri: string,
  method: string,
  signedNonce: string,
  nonce: string,
  params: Record<string, string>,
  ssecurity: string,
): Record<string, string> {
  params["rc4_hash__"] = genEncSignature(uri, method, signedNonce, params);
  for (const k of Object.keys(params)) {
    params[k] = encryptRc4(signedNonce, params[k]);
  }
  params["signature"] = genEncSignature(uri, method, signedNonce, params);
  params["ssecurity"] = ssecurity;
  params["_nonce"] = nonce;
  return params;
}

/** RC4 加密并 base64：key=base64d(password)，丢弃 1024 字节密钥流。 */
export function encryptRc4(password: string, payload: string): string {
  const key = B64D(password);
  const out = rc4(key, Buffer.from(payload, "utf8"), 1024);
  return B64(out);
}

/** RC4 解密：对 base64 输入解出原始字节。 */
export function decryptRc4(password: string, payloadB64: string): Uint8Array {
  const key = B64D(password);
  return rc4(key, B64D(payloadB64), 1024);
}

/** 解密响应：优先 utf-8，失败则按 gzip 解压。 */
export function decrypt(ssecurity: string, nonce: string, payload: string): string {
  const dec = decryptRc4(getSignedNonce(ssecurity, nonce), payload);
  const td = new TextDecoder("utf-8", { fatal: true });
  try {
    return td.decode(dec);
  } catch {
    return gunzipSync(dec).toString("utf8");
  }
}
