import { describe, expect, test } from "bun:test";
import {
  getSignedNonce,
  genEncSignature,
  encryptRc4,
  decryptRc4,
  decrypt,
  generateEncParams,
  genNonce,
} from "../src/miutils";

const ref = await Bun.file(new URL("./reference.json", import.meta.url)).json();

describe("miutils 与 Python 基准对照", () => {
  test("getSignedNonce", () => {
    expect(getSignedNonce(ref.ssecret, ref.nonce)).toBe(ref.signedNonce);
  });

  test("genEncSignature", () => {
    expect(
      genEncSignature("/miotspec/prop/get", "POST", ref.signedNonce, {
        data: '{"a":1,"b":[1,2]}',
      }),
    ).toBe(ref.genEncSignature_params);
  });

  test("generateEncParams", () => {
    const got = generateEncParams(
      "/miotspec/prop/get",
      "POST",
      ref.signedNonce,
      ref.nonce,
      { data: '{"a":1,"b":[1,2]}' },
      ref.ssecret,
    );
    expect(got).toEqual(ref.generateEncParams);
  });

  test("encryptRc4", () => {
    expect(encryptRc4(ref.signedNonce, '{"a":1,"b":[1,2]}')).toBe(ref.encryptRc4);
  });

  test("decryptRc4 roundtrip", () => {
    const ct = encryptRc4(ref.signedNonce, '{"on":true}');
    expect(Buffer.from(decryptRc4(ref.signedNonce, ct)).toString()).toBe('{"on":true}');
  });

  test("decrypt plain（对照 Python 基准）", () => {
    expect(decrypt(ref.ssecret, ref.nonce, ref.decrypt_plain_enc)).toBe(ref.decrypt_plain);
  });

  test("decrypt gzip（对照 Python 基准）", () => {
    expect(decrypt(ref.ssecret, ref.nonce, ref.decrypt_gzip_enc)).toBe(ref.decrypt_gzip);
  });

  test("genNonce 结构（8 随机字节 + 时间字节，base64）", () => {
    const n = genNonce(1756600000000);
    const buf = Buffer.from(n, "base64");
    expect(buf.length).toBeGreaterThanOrEqual(8);
    // 前 8 字节为随机数，其后为 floor(ms/60000) 的最小大端字节
    const part2 = Math.floor(1756600000000 / 60000);
    const tail = buf.subarray(8);
    let v = 0;
    for (const b of tail) v = v * 256 + b;
    expect(v).toBe(part2);
  });
});
