// 迷你 CookieJar + 手动跟随重定向（等价于 requests.Session 的 cookie 行为）
export class CookieJar {
  private map = new Map<string, string>();

  setFromResponse(headers: Headers): void {
    let sets: string[] = [];
    const gs = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof gs === "function") {
      sets = gs.call(headers);
    } else {
      const raw = headers.get("set-cookie");
      if (raw) sets = [raw];
    }
    for (const line of sets) {
      const pair = line.split(";")[0];
      const idx = pair.indexOf("=");
      if (idx < 0) continue;
      this.map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  all(): Record<string, string> {
    return Object.fromEntries(this.map);
  }
}

/** 跟随重定向并在每跳捕获 Set-Cookie，返回最终响应 + 累积的 cookie。 */
export async function fetchFollowCookies(
  url: string,
  init: RequestInit,
  jar: CookieJar,
): Promise<Response> {
  let u = url;
  for (let i = 0; i < 10; i++) {
    const headers = new Headers(init.headers ?? {});
    const ck = jar.header();
    if (ck) headers.set("Cookie", ck);
    const res = await fetch(u, { ...init, headers, redirect: "manual" });
    jar.setFromResponse(res.headers);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      u = new URL(loc, u).toString();
      continue;
    }
    return res;
  }
  throw new Error("重定向次数过多");
}
