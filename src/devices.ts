// 设备高层封装（TypeScript 移植版，源：archive/home_ai/devices.py）
// 说明：Python 版靠 __getattr__/__setattr__ 实现 device.brightness 这种魔法属性，
// 但 TS 网络请求是异步，故改为显式 async 方法：await device.get("brightness")。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { mijiaAPI } from "./apis.ts";
import {
  DeviceActionError,
  DeviceGetError,
  DeviceNotFoundError,
  DeviceSetError,
  GetDeviceInfoError,
  MultipleDevicesFoundError,
} from "./errors.ts";
import { logger } from "./logger.ts";
import { version } from "./version.ts";

const deviceUrl = "https://home.miot-spec.com/spec/";
const deviceInfoVersion = 1;

export interface DeviceInfo {
  version: number;
  name: string;
  model: string;
  properties: any[];
  actions: any[];
}

function deduplicateNames(items: any[], iidKey: string): void {
  const count = (): Record<string, number> => {
    const c: Record<string, number> = {};
    for (const it of items) c[it["name"]] = (c[it["name"]] ?? 0) + 1;
    return c;
  };
  let nameCounts = count();
  for (const it of items) {
    if (nameCounts[it["name"]] > 1) it["name"] = `${it["name"]}-${it["method"]["siid"]}`;
  }
  nameCounts = count();
  for (const it of items) {
    if (nameCounts[it["name"]] > 1) it["name"] = `${it["name"]}-${it["method"][iidKey]}`;
  }
}

export class DevProp {
  name: string;
  desc: string;
  type: string;
  rw: string;
  range: any[] | null;
  valueList: any[] | null;
  method: Record<string, any>;

  constructor(prop: Record<string, any>) {
    this.name = prop["name"];
    this.desc = prop["description"];
    this.type = prop["type"];
    if (!["bool", "int", "uint", "float", "string"].includes(this.type)) {
      throw new Error(`不支持的类型: ${this.type}, 可选类型: bool, int, uint, float, string`);
    }
    this.rw = prop["rw"];
    this.range = prop["range"];
    this.valueList = prop["value-list"] ?? null;
    this.method = prop["method"];
  }

  toString(): string {
    const lines = [
      `  ${this.name}: ${this.desc}`,
      `    valuetype: ${this.type}, rw: ${this.rw}, range: ${JSON.stringify(this.range)}`,
    ];
    if (this.valueList) {
      for (const item of this.valueList) lines.push(`    ${item["value"]}: ${item["description"]}`);
    }
    return lines.join("\n");
  }
}

export class DevAction {
  name: string;
  desc: string;
  method: Record<string, any>;
  constructor(act: Record<string, any>) {
    this.name = act["name"];
    this.desc = act["description"];
    this.method = act["method"];
  }
  toString(): string {
    return `  ${this.name}: ${this.desc}`;
  }
}

function parseBool(value: any): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "0" || v === "1") return Boolean(Number(v));
    throw new Error(`无效布尔值: ${value}`);
  }
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
    throw new Error(`无效布尔值: ${value}`);
  }
  throw new Error(`无效布尔值: ${value}`);
}

export class mijiaDevice {
  api: mijiaAPI;
  did: string;
  model: string;
  name: string;
  sleepTime: number;
  propList: Record<string, DevProp> = {};
  actionList: Record<string, DevAction> = {};
  private sleep = (): Promise<void> =>
    new Promise((r) => setTimeout(r, Math.max(0, this.sleepTime * 1000)));

  constructor(
    api: mijiaAPI,
    did?: string,
    devName?: string,
    sleepTime = 0.5,
  ) {
    this.api = api;
    this.sleepTime = sleepTime;
    if (did == null && devName == null) {
      throw new Error("必须提供 did 或 dev_name 参数之一");
    }
    if (did != null && devName != null) {
      logger.warning("同时提供了 did 和 dev_name 参数，将忽略 dev_name");
    }
    // 构造器内无法 await；改用静态工厂
    throw new Error("请使用 mijiaDevice.create(api, ...) 异步工厂方法");
  }

  static async create(
    api: mijiaAPI,
    did?: string,
    devName?: string,
    sleepTime = 0.5,
  ): Promise<mijiaDevice> {
    const d = Object.create(mijiaDevice.prototype);
    d.api = api;
    d.sleepTime = sleepTime;
    if (did == null && devName == null) {
      throw new Error("必须提供 did 或 dev_name 参数之一");
    }
    if (did != null && devName != null) {
      logger.warning("同时提供了 did 和 dev_name 参数，将忽略 dev_name");
    }

    const devicesList = await api.getDevicesList();
    let model: string;
    if (did == null) {
      const matches = devicesList.filter((device) => device["name"] === devName);
      if (!matches.length) throw new DeviceNotFoundError(devName!);
      if (matches.length > 1) {
        throw new MultipleDevicesFoundError(
          `找到多个 dev_name 为 '${devName}' 的设备，请使用 did 参数指定具体设备或者修改设备名称以区分`,
        );
      }
      did = matches[0]["did"];
      model = matches[0]["model"];
    } else {
      const matches = devicesList.filter((device) => device["did"] === did);
      if (!matches.length) throw new DeviceNotFoundError(did);
      if (matches.length > 1) {
        throw new MultipleDevicesFoundError(
          `找到多个 did 为 '${did}' 的设备，未预想的问题，欢迎提交 issue`,
        );
      }
      devName = matches[0]["name"] ?? undefined;
      model = matches[0]["model"];
    }

    const devInfo = await getDeviceInfo(model, dirname(api.authDataPath));
    d.did = did;
    d.model = model;
    d.name = devName ?? devInfo["name"];

    for (const prop of devInfo["properties"] ?? []) {
      const propObj = new DevProp(prop);
      const name = prop["name"];
      d.propList[name] = propObj;
      if (name.includes("-")) d.propList[name.replace(/-/g, "_")] = propObj;
    }
    for (const act of devInfo["actions"] ?? []) {
      d.actionList[act["name"]] = new DevAction(act);
    }
    return d;
  }

  toString(): string {
    const props = Object.entries(this.propList)
      .filter(([k]) => !k.includes("_"))
      .map(([, v]) => v.toString())
      .filter(Boolean)
      .join("\n");
    const acts = Object.values(this.actionList).map((a) => a.toString()).join("\n");
    return `${this.name} (${this.model})\nProperties:\n${props || "No properties available"}\nActions:\n${acts || "No actions available"}`;
  }

  /** 读取设备属性（await device.get("brightness")） */
  async get(name: string): Promise<any> {
    const prop = this.propList[name];
    if (!prop) throw new Error(`不支持的属性: ${name}, 可用属性: ${Object.keys(this.propList)}`);
    if (!prop.rw.includes("r")) throw new Error(`属性 ${name} 不可读取`);
    const method = { ...prop.method, did: this.did };
    const result = await this.api.getDevicesProp(method);
    if (result["code"] !== 0) throw new DeviceGetError(this.name, name, result["code"]);
    await this.sleep();
    logger.debug(`获取属性: ${this.name} -> ${name}, 结果: ${JSON.stringify(result)}`);
    return result["value"];
  }

  /** 设置设备属性（await device.set("brightness", 60)） */
  async set(name: string, value: any): Promise<void> {
    const prop = this.propList[name];
    if (!prop) throw new Error(`不支持的属性: ${name}, 可用属性: ${Object.keys(this.propList)}`);
    if (!prop.rw.includes("w")) throw new Error(`属性 ${name} 不可写入`);

    if (prop.type === "bool") {
      value = parseBool(value);
    } else if (prop.type === "int" || prop.type === "uint") {
      value = Number(value);
      if (!Number.isInteger(value)) throw new Error(`无效整数: ${value}`);
      if (prop.range && prop.range.length >= 2) {
        if (value < prop.range[0] || value > prop.range[1]) {
          throw new Error(`${value} 超出数值范围, 应该在 ${prop.range[0]}-${prop.range[1]} 之间`);
        }
        if (prop.range.length >= 3 && prop.range[2] !== 1 && (value - prop.range[0]) % prop.range[2] !== 0) {
          throw new Error(`无效的值: ${value}, 应该在范围 ${prop.range[0]}-${prop.range[1]} 内且步长为 ${prop.range[2]}`);
        }
      }
    } else if (prop.type === "float") {
      value = Number(value);
      if (prop.range && prop.range.length >= 2) {
        if (value < prop.range[0] || value > prop.range[1]) {
          throw new Error(`${value} 超出数值范围, 应该在 ${prop.range[0]}-${prop.range[1]} 之间`);
        }
        if (prop.range.length >= 3 && Number.isInteger(prop.range[2]) && (value - prop.range[0]) % prop.range[2] !== 0) {
          throw new Error(`无效的值: ${value}, 应该在范围 ${prop.range[0]}-${prop.range[1]} 内且步长为 ${prop.range[2]}`);
        }
      }
    } else if (prop.type === "string") {
      if (typeof value !== "string") throw new Error(`无效字符串值: ${value}`);
    } else {
      throw new Error(`不支持的类型: ${prop.type}, 可用类型: bool, int, uint, float, string`);
    }
    if (prop.valueList && !prop.valueList.some((item) => item["value"] === value)) {
      throw new Error(`无效值: ${value}, 请使用 ${JSON.stringify(prop.valueList)}`);
    }

    const method = { ...prop.method, did: this.did, value };
    const result = await this.api.setDevicesProp(method);
    if (result["code"] === 1) {
      logger.warning(`网关已经接收指令，无法判断是否设置成功: ${this.name} -> ${name}, 值: ${value}`);
    } else if (result["code"] !== 0) {
      throw new DeviceSetError(this.name, name, result["code"]);
    }
    await this.sleep();
    logger.debug(`设置属性: ${this.name} -> ${name}, 值: ${value}, 结果: ${JSON.stringify(result)}`);
  }

  /** 执行设备动作（await device.runAction("toggle") 或 runAction("toggle", [2])） */
  async runAction(name: string, value?: any[], kwargs: Record<string, any> = {}): Promise<void> {
    const act = this.actionList[name];
    if (!act) throw new Error(`不支持的动作: ${name}, 可用动作: ${Object.keys(this.actionList)}`);
    const method = { ...act.method, did: this.did };
    if (value != null) method["value"] = value;
    for (const [k, v] of Object.entries(kwargs)) {
      let key = k;
      if (key.startsWith("_")) key = key.slice(1);
      if (key in method) throw new Error(`无效的参数: ${k}. 请勿使用以下参数 (${Object.keys(method).join(", ")})`);
      method[key] = v;
    }
    const result = await this.api.runAction(method);
    if (result["code"] === 1) {
      logger.warning(`网关已经接收指令，无法判断是否执行成功: ${this.name} -> ${name}`);
    } else if (result["code"] !== 0) {
      throw new DeviceActionError(this.name, name, result["code"]);
    }
    await this.sleep();
    logger.debug(`执行动作: ${this.name} -> ${name}, 结果: ${JSON.stringify(result)}`);
  }
}

/** 获取设备规格信息，支持缓存到 cachePath/{model}.json。 */
export async function getDeviceInfo(
  deviceModel: string,
  cachePath?: string,
): Promise<DeviceInfo> {
  let cacheFile: string | undefined;
  if (cachePath != null) {
    cacheFile = join(cachePath, `${deviceModel}.json`);
    if (existsSync(cacheFile)) {
      logger.debug(`从缓存加载设备信息: ${cacheFile}`);
      const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (cached["version"] === deviceInfoVersion) return cached;
      logger.debug(`设备信息缓存版本不匹配，重新获取: ${cacheFile}`);
    }
  }

  const res = await fetch(deviceUrl + deviceModel, {
    headers: { "User-Agent": `home-ai/${version}` },
  });
  if (res.status !== 200) throw new GetDeviceInfoError(deviceModel);
  const text = await res.text();
  const m = text.match(/<script data-page="app" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new GetDeviceInfoError(deviceModel);
  const content = JSON.parse(m[1]);

  const product = content["props"]["product"];
  const name = product["name"];
  const model = product["model"];
  const i18nZh = content["props"]?.["i18n"]?.["zh_cn"] ?? {};
  const result: DeviceInfo = {
    version: deviceInfoVersion,
    name,
    model,
    properties: [],
    actions: [],
  };
  const services = content["props"]["tree"]["services"];

  for (const svc of services) {
    const siid = svc["iid"];
    for (const prop of svc["properties"] ?? []) {
      const piid = prop["iid"];
      const format = prop["format"];
      const propType = format.startsWith("int") ? "int" : format.startsWith("uint") ? "uint" : format;
      const accessStr = `${prop["access"].includes("read") ? "r" : ""}${prop["access"].includes("write") ? "w" : ""}`;
      const zhCn = i18nZh[`service:${String(siid).padStart(3, "0")}:property:${String(piid).padStart(3, "0")}`] ?? "";
      const item = {
        name: prop["type"],
        description: `${prop["description"]} / ${zhCn}`.replace(/ \/ $/, ""),
        type: propType,
        rw: accessStr,
        range: prop["valueRange"] ?? null,
        "value-list": null,
        method: { siid, piid },
      };
      if (prop["valueList"]) {
        item["value-list"] = [];
        for (const vl of prop["valueList"]) {
          const vlZh = i18nZh[vl["i18nKey"] ?? ""] ?? "";
          const entry: Record<string, any> = { value: vl["value"], description: vl["description"] };
          if (vlZh) entry["desc_zh_cn"] = vlZh;
          item["value-list"].push(entry);
        }
      }
      result["properties"].push(item);
    }
    for (const act of svc["actions"] ?? []) {
      const aiid = act["iid"];
      const zhCn = i18nZh[`service:${String(siid).padStart(3, "0")}:action:${String(aiid).padStart(3, "0")}`] ?? "";
      result["actions"].push({
        name: act["type"],
        description: `${act["description"]} / ${zhCn}`.replace(/ \/ $/, ""),
        method: { siid, aiid },
      });
    }
  }

  deduplicateNames(result["properties"], "piid");
  deduplicateNames(result["actions"], "aiid");

  if (cacheFile != null) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    logger.debug(`缓存设备信息到: ${cacheFile}`);
    writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  }
  return result;
}
