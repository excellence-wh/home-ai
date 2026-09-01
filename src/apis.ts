// 米家云 API 客户端（TypeScript 移植版，忠实于 archive/home_ai/apis.py）
// 公共方法名保持 snake_case 以对齐文档与 Python 版 API。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import QRCode from "qrcode";

import { ERROR_CODE, APIError, LoginError } from "./errors.ts";
import { logger } from "./logger.ts";
import {
  decrypt,
  genNonce,
  generateEncParams,
  getSignedNonce,
} from "./miutils.ts";
import { CookieJar, fetchFollowCookies } from "./cookies.ts";

const WINDOW = 60_000;

function pick(locale: string | undefined, part: 0 | 1): string {
  if (!locale) return part === 1 ? "CN" : "";
  const [lang, country] = locale.split("_");
  return part === 0 ? lang : country ?? "CN";
}

/** 生成 random.choices(chars, k) 风格的字符串 */
function randChoices(chars: string, k: number): string {
  let s = "";
  for (let i = 0; i < k; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class mijiaAPI {
  locale: string;
  apiBaseUrl = "https://api.mijia.tech/app";
  loginUrl = "https://account.xiaomi.com/longPolling/loginUrl";
  serviceLoginUrl: string;
  authDataPath: string;
  authData: Record<string, any> = {};

  private _availableCache: boolean | null = null;
  private _availableCacheTime = 0;

  constructor(authDataPath?: string) {
    const envLocale = process.env.MIJIA_LOCALE;
    this.locale = envLocale && envLocale.includes("_") ? envLocale : "zh_CN";
    this.serviceLoginUrl =
      `https://account.xiaomi.com/pass/serviceLogin?_json=true&sid=mijia&_locale=${this.locale}`;

    if (!authDataPath) {
      this.authDataPath = join(homedir(), ".config", "mijia-api", "auth.json");
    } else if (existsSync(authDataPath) && authDataPath.split(/[\\/]/).pop() === "") {
      throw new Error("路径无效");
    } else if (isDir(authDataPath)) {
      this.authDataPath = join(authDataPath, "auth.json");
    } else {
      this.authDataPath = authDataPath;
    }

    if (existsSync(this.authDataPath)) {
      this.authData = JSON.parse(readFileSync(this.authDataPath, "utf8"));
    }
  }

  get countryCode(): string {
    return pick(this.locale, 1);
  }

  get pass_o(): string {
    if ("pass_o" in this.authData) return this.authData["pass_o"];
    this.authData["pass_o"] = randChoices("0123456789abcdef", 16);
    return this.authData["pass_o"];
  }

  get user_agent(): string {
    if ("ua" in this.authData) return this.authData["ua"];
    const ua1 = randChoices("0123456789ABCDEF", 40);
    const ua2 = randChoices("0123456789ABCDEF", 32);
    const ua3 = randChoices("0123456789ABCDEF", 32);
    const ua4 = randChoices("0123456789ABCDEF", 40);
    this.authData["ua"] =
      `Android-15-11.0.701-Xiaomi-23046RP50C-OS2.0.212.0.VMYCNXM-` +
      `${ua1}-${this.countryCode}-${ua3}-${ua2}-SmartHome-MI_APP_STORE-${ua1}|${ua4}|${this.pass_o}-64`;
    return this.authData["ua"];
  }

  get deviceId(): string {
    if ("deviceId" in this.authData) return this.authData["deviceId"];
    this.authData["deviceId"] = randChoices(
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-",
      16,
    );
    return this.authData["deviceId"];
  }

  /** 构造 miot API 请求用的 Cookie 头（对齐 Python _init_session）。 */
  private sessionCookieHeader(): string {
    const now = new Date();
    const offMin = -now.getTimezoneOffset();
    const sign = offMin >= 0 ? "+" : "-";
    const abs = Math.abs(offMin);
    const gmt = `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    const winter = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const isDst = now.getTimezoneOffset() !== winter ? 1 : 0;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
    return [
      `cUserId=${this.authData["cUserId"] ?? ""}`,
      `yetAnotherServiceToken=${this.authData["serviceToken"] ?? ""}`,
      `serviceToken=${this.authData["serviceToken"] ?? ""}`,
      `timezone_id=${tz}`,
      `timezone=${gmt}`,
      `is_daylight=${isDst}`,
      `dst_offset=${isDst * 3600 * 1000}`,
      `channel=MI_APP_STORE`,
      `countryCode=${this.countryCode}`,
      `PassportDeviceId=${this.deviceId}`,
      `locale=${this.locale}`,
    ].join("; ");
  }

  private guardAuthKeys(): boolean {
    const keys = ["ua", "ssecurity", "userId", "cUserId", "serviceToken"];
    return !this.authData || keys.some((k) => !(k in this.authData));
  }

  get available(): boolean {
    if (!this.authData) return false;
    if (this.guardAuthKeys()) return false;

    const current = Math.floor(Date.now() / 1000);
    if (current - this._availableCacheTime < 60) {
      logger.debug(`使用缓存的available结果: ${this._availableCache}`);
      return this._availableCache === true;
    }

    try {
      this.checkNewMsg(Math.floor(Date.now() / 1000) - 3600, false);
    } catch {
      this._availableCache = null;
      this._availableCacheTime = 0;
      return false;
    }
    this._availableCache = true;
    this._availableCacheTime = current;
    return true;
  }

  private parseServiceRet(text: string): any {
    return JSON.parse(text.replace("&&&START&&&", ""));
  }

  private async handleRet(res: Response, verifyCode = true): Promise<any> {
    if (res.status !== 200) {
      throw new LoginError(res.status, await res.text());
    }
    const data = this.parseServiceRet(await res.text());
    if (verifyCode && (data["code"] ?? 0) !== 0) {
      throw new LoginError(data["code"], data["desc"] ?? "未知错误");
    }
    return data;
  }

  private async printQr(loginUrl: string): Promise<void> {
    logger.info("请使用米家APP扫描下方二维码");
    try {
      const ascii = await QRCode.toString(loginUrl, { type: "terminal", small: true });
      console.log(ascii);
    } catch {
      console.log("无法在终端显示二维码，请打开链接查看图片");
    }
  }

  private saveAuthData(): void {
    this.authData["saveTime"] = Date.now();
    mkdirSync(dirname(this.authDataPath), { recursive: true });
    writeFileSync(this.authDataPath, JSON.stringify(this.authData, null, 2));
    logger.debug(`已保存认证数据到 ${this.authDataPath}`);
  }

  /** 从 serviceLogin 获取签名数据；code==0 时跟随 location 收 cookie 刷新 token。 */
  private async getLocation(): Promise<Record<string, any>> {
    const headers = {
      "User-Agent": this.user_agent,
      Connection: "keep-alive",
      "Accept-Encoding": "gzip",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: [
        `deviceId=${this.deviceId}`,
        `pass_o=${this.pass_o}`,
        `passToken=${this.authData["passToken"] ?? ""}`,
        `userId=${this.authData["userId"] ?? ""}`,
        `cUserId=${this.authData["cUserId"] ?? ""}`,
        `uLocale=${this.locale}`,
      ].join(";"),
    };
    const serviceRet = await fetch(this.serviceLoginUrl, { headers, redirect: "follow" });
    const serviceData = await this.handleRet(serviceRet, false);
    const location = serviceData["location"] as string;
    if (serviceData["code"] === 0) {
      const jar = new CookieJar();
      const ret = await fetchFollowCookies(location, { headers }, jar);
      if (ret.status === 200 && (await ret.text()) === "ok") {
        this.authData = { ...this.authData, ...jar.all() };
        this.authData["ssecurity"] = serviceData["ssecurity"];
        return { code: 0, message: "刷新Token成功" };
      }
    }
    const loc = new URL(location);
    const out: Record<string, string> = {};
    for (const [k, v] of loc.searchParams.entries()) out[k] = v;
    return out;
  }

  async refreshToken(): Promise<Record<string, any>> {
    if (this.available) {
      logger.debug("Token 有效，无需刷新");
      return this.authData;
    }
    const locationData = await this.getLocation();
    if (locationData["code"] === 0 && locationData["message"] === "刷新Token成功") {
      this.saveAuthData();
      logger.debug("刷新Token成功");
      return this.authData;
    }
    throw new LoginError(-1, "刷新Token失败，请重新登录");
  }

  async login(..._args: unknown[]): Promise<Record<string, any>> {
    return this.QRlogin();
  }

  async QRlogin(): Promise<Record<string, any>> {
    const loginData = await this.getQrLoginData();
    if (loginData["refreshed"]) return this.authData;
    await this.printQr(loginData["loginUrl"] as string);
    console.log(`也可以访问链接查看二维码图片: ${loginData["qr"]}`);
    return this.completeQrLogin(loginData);
  }

  /** 获取二维码登录数据；token 有效则返回 {refreshed:true}。 */
  async getQrLoginData(): Promise<Record<string, any>> {
    const locationData = await this.getLocation();
    if (locationData["code"] === 0 && locationData["message"] === "刷新Token成功") {
      this.saveAuthData();
      logger.info("刷新Token成功，无需登录");
      return { refreshed: true };
    }
    locationData["theme"] = "";
    locationData["bizDeviceType"] = "";
    locationData["_hasLogo"] = "false";
    locationData["_qrsize"] = "240";
    locationData["_dc"] = String(Date.now());

    const url = this.loginUrl + "?" + new URLSearchParams(locationData).toString();
    const headers = {
      "User-Agent": this.user_agent,
      "Accept-Encoding": "gzip",
      "Content-Type": "application/x-www-form-urlencoded",
      Connection: "keep-alive",
    };
    const loginRet = await fetch(url, { headers, redirect: "follow" });
    return this.handleRet(loginRet);
  }

  /** 长轮询等待扫码并完成登录（不阻塞实现，由调用方控制时序）。 */
  async completeQrLogin(loginData: Record<string, any>): Promise<Record<string, any>> {
    const headers = {
      "User-Agent": this.user_agent,
      "Accept-Encoding": "gzip",
      "Content-Type": "application/x-www-form-urlencoded",
      Connection: "keep-alive",
    };
    const jar = new CookieJar();
    let lpData: Record<string, any>;
    try {
      const lp = await Promise.race([
        fetchFollowCookies(loginData["lp"] as string, { headers }, jar),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new LoginError(-1, "超时，请重试")), 120_000),
        ),
      ]);
      lpData = await this.handleRet(lp);
    } catch (e) {
      if (e instanceof LoginError && e.code === -1) throw e;
      throw new LoginError(-1, "超时，请重试");
    }

    for (const key of ["psecurity", "nonce", "ssecurity", "passToken", "userId", "cUserId"]) {
      this.authData[key] = lpData[key];
    }
    const callbackUrl = lpData["location"] as string;
    await fetchFollowCookies(callbackUrl, { headers }, jar);
    this.authData = { ...this.authData, ...jar.all() };
    this.authData["expireTime"] = Date.now() + 30 * 24 * 3600 * 1000;
    this.saveAuthData();
    logger.info("登录成功");
    return this.authData;
  }

  /** 核心请求：加密签名 + form post，失败时解密响应。 */
  private async request(
    uri: string,
    data: Record<string, any>,
    refreshToken = true,
  ): Promise<any> {
    logger.debug(`请求 URI: ${uri}，数据: ${JSON.stringify(data)}`);
    if (refreshToken) await this.refreshToken();
    const url = this.apiBaseUrl + uri;
    const params: Record<string, string> = {
      data: JSON.stringify(data),
    };
    const nonce = genNonce();
    const signedNonce = getSignedNonce(this.authData["ssecurity"], nonce);
    generateEncParams(uri, "POST", signedNonce, nonce, params, this.authData["ssecurity"]);

    const body = new URLSearchParams(params).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.sessionCookieHeader(),
        "miot-accept-encoding": "GZIP",
        "miot-encrypt-algorithm": "ENCRYPT-RC4",
      },
      body,
    });
    const text = await res.text();
    let retData: any;
    try {
      retData = JSON.parse(text);
    } catch {
      retData = JSON.parse(decrypt(this.authData["ssecurity"], nonce, text));
    }
    logger.debug(`响应数据: ${JSON.stringify(retData)}`);
    if ((retData["code"] ?? 0) !== 0 || !("result" in retData)) {
      throw new APIError(retData["code"], retData["message"] ?? retData["desc"] ?? "未知错误");
    }
    return retData["result"];
  }

  private static addHomeId(data: any, homeId: string): any {
    if (Array.isArray(data)) {
      for (const item of data) item["home_id"] = homeId;
      return data;
    }
    if (typeof data === "object" && data !== null) {
      data["home_id"] = homeId;
      return data;
    }
    return data;
  }

  private async getHomeOwner(homeId: string): Promise<number> {
    const homes = await this.getHomesList();
    for (const home of homes) {
      if (String(home["id"]) === String(homeId)) return Number(home["uid"]);
    }
    throw new APIError(-1, `未找到 home_id=${homeId} 的家庭信息`);
  }

  private async getDevicesListByHome(homeId: string): Promise<any[]> {
    let startDid = "";
    let hasMore = true;
    const devices: any[] = [];
    while (hasMore) {
      const data = {
        home_owner: await this.getHomeOwner(homeId),
        home_id: Number(homeId),
        limit: 200,
        start_did: startDid,
        get_split_device: true,
        support_smart_home: true,
        get_cariot_device: true,
        get_third_device: true,
      };
      const ret = await this.request("/home/home_device_list", data);
      if (ret && ret["device_info"]) {
        devices.push(...ret["device_info"]);
        startDid = ret["max_did"] ?? "";
        hasMore = !!(ret["has_more"] && startDid !== "");
      } else {
        hasMore = false;
      }
    }
    return mijiaAPI.addHomeId(devices, homeId);
  }

  private async getScenesListByHome(homeId: string): Promise<any[]> {
    const data = {
      app_version: 12,
      get_type: 2,
      home_id: String(homeId),
      owner_uid: await this.getHomeOwner(homeId),
    };
    const ret = await this.request(
      "/appgateway/miot/appsceneservice/AppSceneService/GetSimpleSceneList",
      data,
    );
    if (ret && "manual_scene_info_list" in ret) {
      return mijiaAPI.addHomeId(ret["manual_scene_info_list"], homeId);
    }
    return [];
  }

  private async getConsumableItemsByHome(homeId: string): Promise<any[]> {
    const data = {
      home_id: Number(homeId),
      owner_id: await this.getHomeOwner(homeId),
      filter_ignore: true,
    };
    const ret = await this.request("/v2/home/standard_consumable_items", data);
    try {
      const items = ret["items"][0]["consumes_data"];
      for (const item of items) {
        if (Array.isArray(item["details"]) && item["details"].length === 1) {
          item["details"] = item["details"][0];
        }
      }
      return mijiaAPI.addHomeId(items, homeId);
    } catch {
      return [];
    }
  }

  checkNewMsg(beginAt = Math.floor(Date.now() / 1000) - 3600, refreshToken = true): Promise<any> {
    return this.request("/v2/message/v2/check_new_msg", { begin_at: beginAt }, refreshToken);
  }

  async getHomesList(): Promise<any[]> {
    const data = {
      fg: true,
      fetch_share: true,
      fetch_share_dev: true,
      fetch_cariot: true,
      limit: 300,
      app_ver: 7,
      plat_form: 0,
    };
    const ret = await this.request("/v2/homeroom/gethome_merged", data);
    return ret["homelist"];
  }

  async getDevicesList(homeId?: string): Promise<any[]> {
    if (homeId == null) {
      const homes = await this.getHomesList();
      const all: any[] = [];
      for (const home of homes) all.push(...(await this.getDevicesListByHome(home["id"])));
      return all;
    }
    return this.getDevicesListByHome(homeId);
  }

  async getSharedDevicesList(): Promise<any[]> {
    const data = {
      ssid: "<unknown ssid>",
      bssid: "02:00:00:00:00:00",
      getVirtualModel: true,
      getHuamiDevices: 1,
      get_split_device: true,
      support_smart_home: true,
      get_cariot_device: true,
      get_third_device: true,
      get_phone_device: true,
      get_miwear_device: true,
    };
    const ret = await this.request("/v2/home/device_list_page", data);
    const devices = ret["list"].filter((i: any) => i["owner"]);
    for (const device of devices) device["home_id"] = "shared";
    return devices;
  }

  async getScenesList(homeId?: string): Promise<any[]> {
    if (homeId == null) {
      const homes = await this.getHomesList();
      const out: any[] = [];
      for (const home of homes) out.push(...(await this.getScenesListByHome(home["id"])));
      return out;
    }
    return this.getScenesListByHome(homeId);
  }

  async runScene(sceneId: string, homeId: string): Promise<any> {
    const data = {
      scene_id: sceneId,
      scene_type: 2,
      phone_id: "null",
      home_id: String(homeId),
      owner_uid: await this.getHomeOwner(homeId),
    };
    return this.request(
      "/appgateway/miot/appsceneservice/AppSceneService/NewRunScene",
      data,
    );
  }

  async getConsumableItems(homeId?: string): Promise<any[]> {
    if (homeId == null) {
      const homes = await this.getHomesList();
      const out: any[] = [];
      for (const home of homes) out.push(...(await this.getConsumableItemsByHome(home["id"])));
      return out;
    }
    return this.getConsumableItemsByHome(homeId);
  }

  async getDevicesProp(data: any): Promise<any> {
    const params = Array.isArray(data) ? data : [data];
    const ret = await this.request("/miotspec/prop/get", { params, datasource: 1 });
    if (!Array.isArray(data) && ret.length === 1) return ret[0];
    return ret;
  }

  async setDevicesProp(data: any): Promise<any> {
    const params = Array.isArray(data) ? data : [data];
    const ret = await this.request("/miotspec/prop/set", { params });
    for (const r of ret) {
      r["message"] = r["code"] && ![0, 1].includes(r["code"])
        ? ERROR_CODE[String(r["code"])] ?? "未知错误"
        : "成功";
    }
    if (!Array.isArray(data) && ret.length === 1) return ret[0];
    return ret;
  }

  async runAction(data: any): Promise<any> {
    const params = Array.isArray(data) ? data : [data];
    const retData: any[] = [];
    for (const param of params) retData.push(await this.request("/miotspec/action", { params: param }));
    for (const r of retData) {
      r["message"] = r["code"] && ![0, 1].includes(r["code"])
        ? ERROR_CODE[String(r["code"])] ?? "未知错误"
        : "成功";
    }
    if (!Array.isArray(data) && retData.length === 1) return retData[0];
    return retData;
  }

  async getStatistics(data: any): Promise<any> {
    const params = Array.isArray(data) ? data : [data];
    const retData: any[] = [];
    for (const param of params) retData.push(await this.request("/v2/user/statistics", param));
    if (!Array.isArray(data) && retData.length === 1) return retData[0];
    return retData;
  }
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && !p.endsWith(".json");
  } catch {
    return false;
  }
}
