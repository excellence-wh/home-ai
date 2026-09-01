# home-ai

米家 API，使用 TypeScript + Bun 实现，可以用代码、CLI、MCP 直接控制米家设备。

> 🎉 原 Python 版已全部移植为 **Bun + TypeScript**（原实现保留在 `archive/`），公共 API
> 与命令行用法保持一致。

本仓库是 [Do1e/mijia-api](https://github.com/Do1e/mijia-api) 的自主维护分支，替换为 TS/Bun 并重置版本 v0.1.0，许可证仍为 GPL-3.0。

[![GitHub](https://img.shields.io/badge/GitHub-excellence--wh%2Fhome--ai-blue)](https://github.com/excellence-wh/home-ai)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg)](https://opensource.org/licenses/GPL-3.0)

## 要求

- [Bun](https://bun.sh) >= 1.0（运行与测试）

## 安装 / 准备

```bash
bun install        # 安装依赖
bun src/cli.ts login   # 扫码登录（认证保存到 ~/.config/mijia-api/auth.json）
```

## 快速开始

```ts
import { mijiaAPI, mijiaDevice } from "./src/index.ts";

const api = new mijiaAPI();     // 已登录时自动加载认证
if (!api.available) await api.login();

// 通过设备名称控制设备（网络异步，需 await）
const device = await mijiaDevice.create(api, undefined, "我的台灯");
await device.set("on", true);         // 打开设备
await device.set("brightness", 60);   // 设置亮度 60%
const b = await device.get("brightness");
console.log(device.toString());        // 打印全部属性和动作
```

> 注：Python 版的 `device.on = True` 魔法属性因 TS 异步不复刻，改用 `await device.set("on", true)` /
> `await device.get("on")`。

## CLI 用法

```bash
bun src/cli.ts login
bun src/cli.ts -l                                    # 列出所有设备
bun src/cli.ts set --dev_name "台灯" --prop_name "brightness" --value 60
bun src/cli.ts get --dev_name "台灯" --prop_name "on"
bun src/cli.ts action --dev_name "台灯" --action_name toggle
bun src/cli.ts run "打开卧室台灯"                        # 通过小爱音箱
bun src/cli.ts --get_device_info yeelink.light.lamp4  # 无需认证
```

## MCP 用法

```bash
# 先登录，然后在 MCP 客户端配置（stdio）中指向：
bun <仓库绝对路径>/src/mcp.ts -p ~/.config/mijia-api/auth.json
```

提供 13 个工具：list_homes / list_devices / list_scenes / list_consumables /
get_device_spec / get_device_properties / set_device_property / run_device_action /
run_scene / get_statistics / run_speaker_command / login / login_status。

## 测试

```bash
bun test
```

密码学层（签名/RC4/nonce/解密）通过 `tests/reference.json`（Python 生成基准）逐项对照验证。

## 目录

- `src/` 库本体（apis / devices / cli / mcp / miutils / cookies / errors / logger）
- `tests/` 对照测试
- `archive/` 原 Python 实现（只读参照）
- `docs/` VitePress 文档站
- `skills/SKILL.md` agent skill

## 致谢

* [janzlan/mijia-api](https://gitee.com/janzlan/mijia-api/tree/master)
* [Do1e/mijia-api](https://github.com/Do1e/mijia-api)（本项目源自它）
* [米家 APP 网络请求的抓包、加解密与构造的代码笔记](https://imkero.net/posts/mihome-app-api/)
* [al-one/hass-xiaomi-miot](https://github.com/al-one/hass-xiaomi-miot)

## 开源许可

本项目采用 [GPL-3.0](LICENSE) 开源许可证。

**请注意：GPL-3.0 是具有“强传染性”的开源许可证。** 如果您在您的项目中使用、修改或分发本项目的代码
（包括作为库依赖），您的整个项目也**必须**以 GPL-3.0 或兼容许可证开源发布。

## 免责声明

* 本项目仅供学习交流使用，不得用于商业用途，如有侵权请联系删除
* 用户使用本项目所产生的任何后果，需自行承担风险
* 开发者不对使用本项目产生的任何直接或间接损失负责
