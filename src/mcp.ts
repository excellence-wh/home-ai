// MCP server（TypeScript 移植版，源：archive/home_ai/mcp_server.py）
// 基于 @modelcontextprotocol/sdk 的 StdioServerTransport。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { mijiaAPI } from "./apis.ts";
import { getDeviceInfo, mijiaDevice } from "./devices.ts";
import { version } from "./version.ts";

const server = new McpServer({ name: "home-ai", version });

let _api: mijiaAPI | null = null;
let _authPath: string | null = null;
// login 后台任务状态
let _loginApi: mijiaAPI | null = null;
let _loginStatus: Record<string, string> = { status: "idle" };

function getApi(): mijiaAPI {
  if (_api) return _api;
  throw new Error("mijiaAPI 未初始化，请先调用 login 工具完成登录");
}

async function refreshIfNeeded(api: mijiaAPI): Promise<void> {
  if (!api.available) {
    try {
      await api.refreshToken();
    } catch {
      throw new Error("认证已失效且无法自动刷新，请调用 login 工具重新登录");
    }
  }
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

server.tool("list_homes", "列出米家所有家庭及房间信息。返回每个家庭的名称、ID、地址、房间列表（含房间内设备名称）。", {}, async () => {
  const api = getApi();
  await refreshIfNeeded(api);
  return text(JSON.stringify(await api.getHomesList()));
});

server.tool(
  "list_devices",
  "列出米家设备列表（包含共享设备）。参数 home_id: 可选，仅列出该家庭的设备；不传则列出所有设备。返回设备名称、did、model、在线状态、所属家庭和房间。",
  { home_id: z.string().optional().describe("可选，指定家庭ID") },
  async ({ home_id }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const devices = [...(await api.getDevicesList()), ...(await api.getSharedDevicesList())];
    const didLocation: Record<string, [string, string]> = {};
    for (const home of await api.getHomesList()) {
      for (const room of home["roomlist"] ?? []) {
        for (const did of room["dids"] ?? []) didLocation[did] = [home["name"], room["name"]];
      }
    }
    for (const device of devices) {
      const [h, r] = didLocation[device["did"]] ?? ["未知", "未知"];
      device["home"] = h;
      device["room"] = r;
    }
    const out = home_id != null ? devices.filter((d) => d["home_id"] === home_id) : devices;
    return text(JSON.stringify(out));
  },
);

server.tool(
  "list_scenes",
  "列出米家手动场景列表。参数 home_id: 可选。返回场景名称、scene_id、所属家庭。",
  { home_id: z.string().optional().describe("可选，指定家庭ID") },
  async ({ home_id }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    return text(JSON.stringify(await api.getScenesList(home_id)));
  },
);

server.tool(
  "list_consumables",
  "列出耗材列表（如滤芯、电池等）。参数 home_id: 可选。返回耗材所属设备、描述、当前值。",
  { home_id: z.string().optional().describe("可选，指定家庭ID") },
  async ({ home_id }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    return text(JSON.stringify(await api.getConsumableItems(home_id)));
  },
);

server.tool(
  "get_device_spec",
  "获取设备规格信息（属性和动作列表）。参数 device_model: 设备型号，可从 list_devices 获取。",
  { device_model: z.string().describe("设备型号，例如 yeelink.light.lamp4") },
  async ({ device_model }) => {
    const api = getApi();
    const info = await getDeviceInfo(device_model, dirnameOf(api.authDataPath));
    return text(JSON.stringify(info));
  },
);

server.tool(
  "get_device_properties",
  "获取设备属性值（高层封装，无需 siid/piid）。参数 dev_name 与 did 二选一；prop_names 可选。",
  {
    dev_name: z.string().optional().describe("设备名称，与 did 二选一"),
    did: z.string().optional().describe("设备did，优先于 dev_name"),
    prop_names: z.array(z.string()).optional().describe("属性名列表，如 [\"brightness\",\"on\"]"),
  },
  async ({ dev_name, did, prop_names }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const device = await mijiaDevice.create(api, did ?? undefined, dev_name ?? undefined);
    const names = prop_names ?? Object.keys(device.propList).filter((k) => !k.includes("_"));
    const result: Record<string, any> = {};
    for (const name of names) {
      const prop = device.propList[name];
      if (!prop || !prop.rw.includes("r")) continue;
      try {
        result[name] = await device.get(name);
      } catch (e: any) {
        result[name] = `<读取失败: ${e.message}>`;
      }
    }
    return text(JSON.stringify(result));
  },
);

server.tool(
  "set_device_property",
  "设置设备属性值（高层封装，无需 siid/piid）。布尔值传 true/false；数值传对应数字。",
  {
    prop_name: z.string().describe("属性名"),
    value: z.string().describe("要设置的值"),
    dev_name: z.string().optional().describe("设备名称，与 did 二选一"),
    did: z.string().optional().describe("设备did，优先于 dev_name"),
  },
  async ({ prop_name, value, dev_name, did }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const device = await mijiaDevice.create(api, did ?? undefined, dev_name ?? undefined);
    await device.set(prop_name, value);
    return text(`${device.name}(${device.did}) 的 ${prop_name} 已设置为 ${value}`);
  },
);

server.tool(
  "run_device_action",
  "执行设备动作（高层封装，无需 siid/aiid）。value 可选，动作参数列表。",
  {
    action_name: z.string().describe("动作名"),
    dev_name: z.string().optional().describe("设备名称，与 did 二选一"),
    did: z.string().optional().describe("设备did，优先于 dev_name"),
    value: z.array(z.any()).optional().describe("动作参数列表"),
  },
  async ({ action_name, dev_name, did, value }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const device = await mijiaDevice.create(api, did ?? undefined, dev_name ?? undefined);
    await device.runAction(action_name, value);
    return text(`${device.name}(${device.did}) 的动作 ${action_name} 执行成功`);
  },
);

server.tool(
  "run_scene",
  "运行米家手动场景。scene_id_or_name: 场景ID或名称，名称需唯一。",
  { scene_id_or_name: z.string().describe("场景ID或名称") },
  async ({ scene_id_or_name }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const scenes = await api.getScenesList();
    const mapping: Record<string, any> = {};
    for (const s of scenes) mapping[s["scene_id"]] = s;
    let target = scene_id_or_name;
    if (!(target in mapping)) {
      const found = scenes.filter((s) => s["name"] === target);
      if (!found.length) return text(`场景 ${scene_id_or_name} 未找到`);
      if (found.length > 1) return text(`找到多个名为 ${scene_id_or_name} 的场景，请使用 scene_id`);
      target = found[0]["scene_id"];
    }
    const scene = mapping[target];
    const ok = await api.runScene(target, scene["home_id"]);
    return text(`场景 ${scene["name"]}(${target}) 运行${ok ? "成功" : "失败"}`);
  },
);

server.tool(
  "get_statistics",
  "获取设备统计数据（如耗电量、使用时长）。注意仅部分设备支持，不同型号 key/data_type 可能不同，详见上游 issue #46。",
  {
    did: z.string().describe("设备ID"),
    key: z.string().describe("统计键，通常为 siid.piid，例如 7.1"),
    data_type: z.string().describe("统计粒度：stat_hour_v3 / stat_day_v3 / stat_week_v3 / stat_month_v3"),
    limit: z.number().optional().describe("返回最大条目数，默认6"),
    time_start: z.number().optional().describe("起始时间戳（秒），默认为30天前"),
    time_end: z.number().optional().describe("结束时间戳（秒），默认为当前时间"),
  },
  async ({ did, key, data_type, limit = 6, time_start, time_end }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const now = Math.floor(Date.now() / 1000);
    const ret = await api.getStatistics({
      did,
      key,
      data_type,
      limit,
      time_start: time_start ?? now - 30 * 24 * 3600,
      time_end: time_end ?? now,
    });
    return text(JSON.stringify(ret));
  },
);

server.tool(
  "run_speaker_command",
  "通过小爱音箱执行自然语言指令。prompt: 自然语言指令；speaker_name 可选；quiet 是否静默。",
  {
    prompt: z.string().describe("自然语言指令，如 打开卧室台灯"),
    speaker_name: z.string().optional().describe("指定小爱音箱名称，默认第一个"),
    quiet: z.boolean().optional().describe("是否静默执行"),
  },
  async ({ prompt, speaker_name, quiet = false }) => {
    const api = getApi();
    await refreshIfNeeded(api);
    const devices = await api.getDevicesList();
    let match: any;
    if (speaker_name == null) {
      match = devices.find((d) => d["model"].includes("xiaomi.wifispeaker"));
      if (!match) return text("未找到小爱音箱设备");
    } else {
      match = devices.find((d) => d["name"] === speaker_name);
      if (!match) return text(`未找到名为 ${speaker_name} 的小爱音箱`);
    }
    const speaker = await mijiaDevice.create(api, match["did"]);
    await speaker.runAction("execute-text-directive", undefined, { _in: [prompt, quiet ? 1 : 0] });
    return text(`已通过 ${match["name"]} 执行: ${prompt}`);
  },
);

async function loginWorker(api: mijiaAPI, loginData: Record<string, any>): Promise<void> {
  try {
    await api.completeQrLogin(loginData);
    _loginStatus = { status: "success", message: "登录成功" };
  } catch (e: any) {
    _loginStatus = { status: "error", message: `登录失败: ${e.message}` };
  }
}

server.tool(
  "login",
  "发起米家二维码登录。当凭证过期且自动刷新失败时使用。返回二维码图片链接，请用米家APP在2分钟内扫码，然后调用 login_status 查询结果。",
  {},
  async () => {
    if (_authPath == null) return text("认证路径未初始化，请检查 MCP server 启动配置");
    if (_loginStatus["status"] === "pending") return text("已有登录正在进行中，请调用 login_status 查询结果");

    if (_api != null && _api.available) return text("凭证仍然有效，无需重新登录");

    const newApi = new mijiaAPI(_authPath);
    const loginData = await newApi.getQrLoginData();
    if (loginData["refreshed"]) {
      _api = newApi;
      return text("Token 刷新成功，无需重新登录");
    }
    _loginApi = newApi;
    _loginStatus = { status: "pending", message: "等待扫码" };
    void loginWorker(newApi, loginData);
    return text(`二维码已生成，请在2分钟内用米家APP扫码完成登录。\n二维码图片链接: ${loginData["qr"]}\n扫码后请调用 login_status 查询登录结果。`);
  },
);

server.tool(
  "login_status",
  "查询 login 发起的二维码登录结果。返回 pending/success/error。成功后后续工具将使用新凭证。",
  {},
  async () => {
    const status = _loginStatus["status"] ?? "idle";
    if (status === "success") {
      _api = _loginApi;
      _loginApi = null;
      _loginStatus = { status: "idle" };
      return text("登录成功，已切换为新凭证，可继续调用其他工具");
    }
    if (status === "error") {
      const message = _loginStatus["message"] ?? "登录失败";
      _loginApi = null;
      _loginStatus = { status: "idle" };
      return text(message);
    }
    return text("等待扫码中，请用米家APP扫描 login 返回的二维码后再次查询");
  },
);

function dirnameOf(p: string): string {
  return p.split(/[\\/]/).slice(0, -1).join("/");
}

export async function runMCP(authPath: string): Promise<void> {
  _authPath = existsSync(authPath) && !authPath.endsWith(".json") ? join(authPath, "auth.json") : authPath;

  if (!existsSync(_authPath)) {
    _api = null;
    console.error(`认证文件不存在: ${_authPath}，请调用 login 工具完成登录后再使用其他工具`);
  } else {
    try {
      _api = new mijiaAPI(_authPath);
      if (!_api.available) await _api.refreshToken();
      if (!_api.available) throw new Error("认证不可用");
      console.error(`MCP server 启动，认证文件: ${_authPath}`);
    } catch (e: any) {
      _api = null;
      console.error(`认证不可用且无法自动刷新: ${e.message}\n请调用 login 工具重新登录后再使用其他工具`);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// 直接运行 `bun src/mcp.ts [-p path]`
if (import.meta.main) {
  const args = process.argv.slice(2);
  const pIdx = args.indexOf("-p");
  const auth = pIdx >= 0 ? args[pIdx + 1] : undefined;
  runMCP(auth ?? join(homedir(), ".config", "mijia-api", "auth.json")).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
