#!/usr/bin/env bun
// CLI（TypeScript 移植版，源：archive/home_ai/__main__.py）
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { mijiaAPI } from "./apis.ts";
import { getDeviceInfo, mijiaDevice } from "./devices.ts";
import { LoginError } from "./errors.ts";
import { runMCP } from "./mcp.ts";
import { version } from "./version.ts";

const defaultAuth = join(homedir(), ".config", "mijia-api", "auth.json");

function jsonObject(v: string): Record<string, any> {
  let result: any;
  try {
    result = JSON.parse(v);
  } catch (e: any) {
    throw new Error(`无效 JSON: ${e.message}`);
  }
  if (typeof result !== "object" || Array.isArray(result)) throw new Error("必须是 JSON 对象");
  return result;
}

interface Ctx {
  command?: string;
  authPath: string;
  flags: Record<string, any>;
  pos: string[];
}

/** 简易 argparse 解析器，兼容子命令 + 互斥组 + nargs+。 */
function parseArgs(argv: string[]): Ctx {
  const ctx: Ctx = { authPath: defaultAuth, flags: {}, pos: [] };
  const SUB = new Set(["run", "mcp", "login", "get", "set", "action", "statistics"]);

  // 全局参数表（值类型：bool | str | str+）
  const GLOBAL: Record<string, { type: "bool" | "str" | "plus"; key: string }> = {
    "-h": { type: "bool", key: "help" },
    "--help": { type: "bool", key: "help" },
    "-v": { type: "bool", key: "version" },
    "--version": { type: "bool", key: "version" },
    "-p": { type: "str", key: "auth_path" },
    "--auth_path": { type: "str", key: "auth_path" },
    "--list_homes": { type: "bool", key: "list_homes" },
    "-l": { type: "bool", key: "list_devices" },
    "--list_devices": { type: "bool", key: "list_devices" },
    "--list_scenes": { type: "bool", key: "list_scenes" },
    "--list_consumable_items": { type: "bool", key: "list_consumable_items" },
    "--run_scene": { type: "plus", key: "run_scene" },
    "--get_device_info": { type: "str", key: "get_device_info" },
    "--run": { type: "str", key: "run_legacy" },
  };

  const i = { n: 0 };
  const peek = () => argv[i.n];
  const next = () => argv[i.n++];

  while (i.n < argv.length) {
    const a = next();
    if (SUB.has(a)) {
      ctx.command = a;
      // 子命令参数
      while (i.n < argv.length) {
        const sa = next();
        if (sa === "-h" || sa === "--help") ctx.flags.help = true;
        else if (sa === "-p" || sa === "--auth_path") ctx.authPath = next();
        else if (a === "run" && sa === "--wifispeaker_name") ctx.flags.wifispeaker_name = next();
        else if (a === "run" && sa === "--quiet") ctx.flags.quiet = true;
        else if (a === "get" || a === "set" || a === "action") {
          if (sa === "--did") ctx.flags.did = next();
          else if (sa === "--dev_name") ctx.flags.dev_name = next();
          else if (sa in { "--prop_name": 1, "--value": 1, "--action_name": 1 }) {
            ctx.flags[sa.slice(2)] = next();
          } else if (sa === "--params") ctx.flags.params = jsonObject(next());
        } else if (a === "statistics") {
          if (sa in { "--did": 1, "--key": 1, "--data_type": 1 }) ctx.flags[sa.slice(2)] = next();
          else if (sa === "--limit") ctx.flags.limit = Number(next());
          else if (sa === "--time_start") ctx.flags.time_start = Number(next());
          else if (sa === "--time_end") ctx.flags.time_end = Number(next());
        } else if (a === "run") {
          // PROMPT 位置参数
          ctx.flags.prompt = sa;
        } else {
          // run 的 PROMPT 位置参数
          if (a === "run" && ctx.flags.prompt === undefined) ctx.flags.prompt = sa;
        }
      }
      break;
    }
    const spec = GLOBAL[a];
    if (spec) {
      if (spec.type === "bool") ctx.flags[spec.key] = true;
      else if (spec.type === "str") ctx.flags[spec.key] = next();
      else {
        // nargs+
        ctx.flags[spec.key] = ctx.flags[spec.key] ?? [];
        ctx.flags[spec.key].push(next());
      }
    } else if (a.startsWith("-")) {
      throw new Error(`未知参数: ${a}`);
    } else {
      ctx.pos.push(a);
    }
  }
  return ctx;
}

function printUsage(command?: string): void {
  const G = `home-ai [-h] [-v] [-p AUTH_PATH] [--list_homes] [-l] [--list_scenes]
            [--list_consumable_items] [--run_scene ...] [--get_device_info MODEL]
            {run,mcp,login,get,set,action,statistics}`;
  const subUsage: Record<string, string> = {
    get: "home-ai get [-p AUTH_PATH] [--did DID|--dev_name NAME] --prop_name NAME",
    set: "home-ai set [-p AUTH_PATH] [--did DID|--dev_name NAME] --prop_name NAME --value VALUE",
    action: "home-ai action [-p AUTH_PATH] (--did DID | --dev_name NAME) --action_name NAME [--params JSON]",
    statistics: "home-ai statistics [-p AUTH_PATH] --did DID --key KEY --data_type TYPE [--limit N]",
    run: "home-ai run [-p AUTH_PATH] [--wifispeaker_name NAME] [--quiet] PROMPT",
    login: "home-ai login [-p AUTH_PATH]",
    mcp: "home-ai mcp [-p AUTH_PATH]",
  };
  if (command && subUsage[command]) {
    console.log(`usage: ${subUsage[command]}`);
  } else {
    console.log(`Mijia API CLI (v${version})`);
    console.log(`usage: ${G}`);
  }
}

async function initApi(authPath: string): Promise<mijiaAPI> {
  const p = existsSync(authPath) ? authPath : authPath.endsWith("auth.json") ? authPath : join(authPath, "auth.json");
  if (existsSync(p) && p.endsWith(".json")) {
    // ok
  } else if (!p.endsWith(".json")) {
    throw new Error(`认证文件不存在: ${p}\n请调用 'home-ai login' 进行扫描登录`);
  } else if (!existsSync(p)) {
    throw new Error(`认证文件不存在: ${p}\n请调用 'home-ai login' 进行扫描登录`);
  }
  if (!existsSync(p)) {
    throw new Error(`认证文件不存在: ${p}\n请调用 'home-ai login' 进行扫描登录`);
  }
  let api: mijiaAPI;
  try {
    api = new mijiaAPI(p);
  } catch {
    throw new Error(`认证文件已损坏: ${p}\n请调用 'home-ai login' 进行扫描登录`);
  }
  if (!api.available) {
    try {
      await api.refreshToken();
    } catch {
      /* ignore */
    }
    if (!api.available) {
      throw new Error(`认证已失效且刷新失败: ${p}\n请调用 'home-ai login' 进行扫描登录`);
    }
  }
  return api;
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function getHomesList(api: mijiaAPI, verbose = true): Promise<Record<string, any>> {
  const homes = await api.getHomesList();
  if (verbose) {
    console.log("家庭列表:");
    for (const home of homes) {
      console.log(`  - ${home["name"]}\n    ID: ${home["id"]}\n    地址: ${home["address"]}\n    房间数量: ${home["roomlist"].length}\n    创建时间: ${fmtTime(home["create_time"])}`);
      console.log("    房间列表:");
      for (const room of home["roomlist"]) {
        console.log(`    - ${room["name"]}\n      ID: ${room["id"]}\n      创建时间: ${fmtTime(room["create_time"])}`);
      }
    }
  }
  return Object.fromEntries(homes.map((h) => [h["id"], h]));
}

async function getDevicesList(api: mijiaAPI, verbose = true): Promise<Record<string, any>> {
  const devices = [...(await api.getDevicesList()), ...(await api.getSharedDevicesList())];
  if (verbose) {
    const didLocation: Record<string, [string, string]> = {};
    const homes = await api.getHomesList();
    for (const home of homes) {
      for (const room of home["roomlist"] ?? []) {
        for (const did of room["dids"] ?? []) didLocation[did] = [home["name"], room["name"]];
      }
    }
    console.log("设备列表:");
    for (const device of devices) {
      const [homeName, roomName] = didLocation[device["did"]] ?? ["未知", "未知"];
      console.log(`  - ${device["name"]}\n    did: ${device["did"]}\n    model: ${device["model"]}\n    home: ${homeName}\n    room: ${roomName}\n    online: ${device["isOnline"]}`);
    }
  }
  return Object.fromEntries(devices.map((d) => [d["did"], d]));
}

async function getScenesList(api: mijiaAPI, verbose = true): Promise<Record<string, any>> {
  const scenes = await api.getScenesList();
  if (verbose) {
    const map: Record<string, [string, string]> = {};
    for (const s of scenes) map[s["home_id"]] = map[s["home_id"]] ?? [(await api.getHomesList()).find((h) => String(h["id"]) === String(s["home_id"]))?.["name"] ?? "?", s["home_id"]];
    for (const s of scenes) {
      console.log(`  - ${s["name"]}\n    ID: ${s["scene_id"]}\n    创建时间: ${fmtTime(Number(s["create_time"]))}`);
    }
  }
  return Object.fromEntries(scenes.map((s) => [s["scene_id"], s]));
}

async function runScene(api: mijiaAPI, sceneId: string, mapping: Record<string, any>): Promise<boolean> {
  let target = sceneId;
  if (!(target in mapping)) {
    const found = Object.entries(mapping).find(([, s]) => s["name"] === sceneId);
    if (!found) {
      console.log(`场景 ${sceneId} 未找到`);
      return false;
    }
    target = found[0];
  }
  const scene = mapping[target];
  const ok = await api.runScene(target, scene["home_id"]);
  console.log(`场景 ${scene["name"]}(${target}) 运行${ok ? "成功" : "失败"}`);
  return ok === true;
}

async function cmdGet(api: mijiaAPI, flags: Record<string, any>): Promise<void> {
  const device = await mijiaDevice.create(api, flags["did"], flags["dev_name"]);
  const value = await device.get(flags["prop_name"]);
  console.log(`${device.name} (${device.did}) 的 ${flags["prop_name"]} 值为 ${value}`);
}

async function cmdSet(api: mijiaAPI, flags: Record<string, any>): Promise<void> {
  const device = await mijiaDevice.create(api, flags["did"], flags["dev_name"]);
  try {
    await device.set(flags["prop_name"], flags["value"]);
  } catch (e: any) {
    console.log(`设置 ${flags["dev_name"]} 的 ${flags["prop_name"]} 值为 ${flags["value"]} 失败: ${e.message}`);
    return;
  }
  console.log(`${device.name} (${device.did}) 的 ${flags["prop_name"]} 值已设置为 ${flags["value"]}`);
}

async function cmdAction(api: mijiaAPI, flags: Record<string, any>): Promise<void> {
  const device = await mijiaDevice.create(api, flags["did"], flags["dev_name"]);
  const p = flags["params"] ?? {};
  const value = p["value"];
  const kwargs = { ...p };
  delete kwargs["value"];
  await device.runAction(flags["action_name"], value, kwargs);
  console.log(`${device.name} (${device.did}) 的动作 ${flags["action_name"]} 指令已发送`);
}

async function cmdStatistics(api: mijiaAPI, flags: Record<string, any>): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const timeEnd = flags["time_end"] ?? now;
  const timeStart = flags["time_start"] ?? timeEnd - 30 * 24 * 3600;
  const ret = await api.getStatistics({
    did: flags["did"],
    key: flags["key"],
    data_type: flags["data_type"],
    limit: flags["limit"] ?? 6,
    time_start: timeStart,
    time_end: timeEnd,
  });
  console.log(JSON.stringify(ret, null, 2));
}

async function cmdRun(api: mijiaAPI, flags: Record<string, any>): Promise<void> {
  const devices = await api.getDevicesList();
  let wifispeaker: any;
  if (flags["wifispeaker_name"] == null) {
    wifispeaker = devices.find((d) => d["model"].includes("xiaomi.wifispeaker"));
    if (!wifispeaker) throw new Error("未找到小爱音箱设备");
  } else {
    wifispeaker = devices.find((d) => d["name"] === flags["wifispeaker_name"]);
    if (!wifispeaker) throw new Error(`未找到小爱音箱: ${flags["wifispeaker_name"]}`);
  }
  const device = await mijiaDevice.create(api, wifispeaker["did"]);
  await device.runAction("execute-text-directive", undefined, { _in: [flags["prompt"], flags["quiet"] ? 1 : 0] });
}

async function main(argv: string[]): Promise<number> {
  let ctx: Ctx;
  try {
    ctx = parseArgs(argv);
  } catch (e: any) {
    console.error(e.message);
    return 1;
  }

  const f = ctx.flags;

  if (f["help"]) {
    printUsage(ctx.command);
    return 0;
  }
  if (f["version"]) {
    console.log(`home-ai ${version}`);
    return 0;
  }
  if (ctx.command === "mcp") {
    await runMCP(ctx.authPath);
    return 0;
  }
  if (f["run_legacy"] != null) {
    console.error("错误: '--run' 参数已弃用，请使用 'run' 子命令代替。");
    console.error(`新用法: home-ai run "${f["run_legacy"]}"`);
    return 1;
  }
  if (f["get_device_info"]) {
    const info = await getDeviceInfo(f["get_device_info"]);
    console.log(JSON.stringify(info, null, 2));
  }

  const hasAction =
    f["list_homes"] || f["list_devices"] || f["list_scenes"] || f["list_consumable_items"] ||
    f["run_scene"] || ctx.command != null;
  if (!hasAction) return 0;

  if (ctx.command === "login") {
    const authPath = ctx.authPath;
    let api: mijiaAPI;
    try {
      api = new mijiaAPI(authPath);
    } catch {
      const p = authPath.endsWith("auth.json") ? authPath : join(authPath, "auth.json");
      api = new mijiaAPI(p);
    }
    if (!api.available) await api.login();
    return 0;
  }

  let api: mijiaAPI;
  try {
    api = await initApi(ctx.authPath);
  } catch (e: any) {
    console.error(e.message);
    return 1;
  }

  let deviceMapping: Record<string, any> | undefined;
  let homeMapping: Record<string, any> | undefined;
  let scenesMapping: Record<string, any> | undefined;

  if (f["list_devices"]) {
    if (!homeMapping) homeMapping = await getHomesList(api, false);
    deviceMapping = await getDevicesList(api, true);
  }
  if (f["list_homes"]) homeMapping = await getHomesList(api, true);
  if (f["list_scenes"]) scenesMapping = await getScenesList(api, true);
  if (f["list_consumable_items"]) {
    const items = await api.getConsumableItems();
    for (const it of items) {
      console.log(`  - ${it["name"]}(${it["did"]}) 中的 ${it["details"]?.["description"]}\n    值: ${it["details"]?.["value"]}`);
    }
  }
  if (f["run_scene"]) {
    const mapping = scenesMapping ?? (await getScenesList(api, false));
    for (const sid of f["run_scene"]) await runScene(api, sid, mapping);
  }

  if (ctx.command === "get") await cmdGet(api, f);
  else if (ctx.command === "set") await cmdSet(api, f);
  else if (ctx.command === "action") await cmdAction(api, f);
  else if (ctx.command === "statistics") await cmdStatistics(api, f);
  else if (ctx.command === "run") await cmdRun(api, f);
  return 0;
}

// 直接执行
if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: any) => {
      console.error(e instanceof LoginError ? `${e.message}` : (e?.message ?? e));
      process.exit(1);
    });
}
