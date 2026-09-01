# 快速开始

本页将带你完成 home-ai 的基本使用流程：登录 → 获取设备 → 控制设备。

> 说明：本项目是 **TypeScript + Bun** 实现，公共 API 方法名与 Python 版一致（snake_case），
> 但网络请求是异步的，设备控制需 `await`。

## 登录

首次使用需要通过二维码登录，认证数据将被保存以便后续使用：

```ts
import { mijiaAPI } from "./src/index.ts";

// 初始化API（认证文件默认保存在 ~/.config/mijia-api/auth.json）
const api = new mijiaAPI();

// 登录（如果Token有效会自动跳过）—— 会打印二维码，用米家APP扫码
if (!api.available) await api.login();
```

也可以在终端用 CLI 登录：

```bash
bun src/cli.ts login
```

::: tip
用于访问 API 的 `serviceToken` 有效期较短，但已实现自动刷新。用于刷新的 `passToken`
有效期约为一个月，即扫码登录后理论上可以保活一个月，实际上会更长。
:::

## 获取设备列表

```ts
import { mijiaAPI } from "./src/index.ts";

const api = new mijiaAPI();
if (!api.available) await api.login();

// 获取所有设备（包含共享设备）
const devices = await api.getDevicesList();
for (const device of devices) {
  console.log(`设备名称: ${device["name"]}, Model: ${device["model"]}, Did: ${device["did"]}`);
}
```

## 控制设备（推荐方式）

使用 `mijiaDevice` 类按名称操作设备，无需关心 siid/piid：

```ts
import { mijiaAPI, mijiaDevice } from "./src/index.ts";

const api = new mijiaAPI();
if (!api.available) await api.login();

// 通过设备名称初始化（推荐，更人性化）
const device = await mijiaDevice.create(api, undefined, "我的台灯");

// 获取属性值
console.log(`当前亮度: ${await device.get("brightness")}%`);

// 设置属性值
await device.set("on", true);             // 打开设备
await device.set("brightness", 60);       // 设置亮度为 60%
await device.set("color_temperature", 5000); // 设置色温

// 执行动作
await device.runAction("toggle");

// 查看设备支持的所有属性和动作
console.log(device.toString());
```

::: tip
包含 `-` 的属性名请使用下划线 `_` 替代，例如 `color-temperature` 对应 `get/set("color_temperature")`。
当设备的多个服务包含同名属性时，属性名会追加 `siid`，例如三键开关的 `on-2`、`on-3`、`on-4`
分别可通过 `on_2`、`on_3`、`on_4` 访问。

> Python 版的 `device.on = True` 魔法属性因 TS 异步不复刻，请使用 `await device.set("on", true)`。
:::

## CLI 命令行

也可以直接使用命令行工具控制设备（`bun link` 后可用 `home-ai`）：

```bash
# 扫码登录
home-ai login

# 列出所有设备
home-ai -l

# 设置设备属性
home-ai set --dev_name "台灯" --prop_name "brightness" --value 60

# 获取设备规格（无需认证）
home-ai --get_device_info yeelink.light.lamp4
```

## 下一步

- [API 基础使用](/usage/basic-api) — 了解 siid/piid 原始调用方式（示例为 Python，逻辑一致）
- [mijiaDevice 高级封装](/usage/mijia-device) — 深入了解面向对象的设备控制
- [CLI 命令行](/usage/cli) — 完整的 CLI 参数说明
- [MCP Server](/usage/mcp) — 让 LLM 控制你的设备
- [Agent Skill](/usage/skill) — 让 AI 助手通过 CLI 安全控制设备
