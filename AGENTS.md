# home-ai

TypeScript (Bun) 实现的米家智能设备控制库 / CLI / MCP server，驱动小米 MiIo/MIoT 云 API。
包名 `home-ai`，支持代码、CLI、MCP 三种用法。GPL-3.0。

这是 Do1e/mijia-api 的自主维护分支，已将前端/CLI 全部从 Python 移植为 Bun+TypeScript：
原 Python 实现保留在 `archive/`（只读对照，勿改）。公共类名 `mijiaAPI`/`mijiaDevice`、
认证路径 `~/.config/mijia-api/auth.json`、环境变量 `MIJIA_LOG_LEVEL`、公共方法名（snake_case）
保持不变以对齐文档。

## 结构

- `src/` — 库本体
  - `apis.ts` — `mijiaAPI` 类：登录/刷新 token、密钥签名、家庭/设备/场景/统计/耗材等所有端点
  - `devices.ts` — `mijiaDevice` + `getDeviceInfo`（规格解析/缓存）、属性校验
  - `miutils.ts` — 签名/加解密（sha1/sha256、纯 JS RC4、nonce、gzip）
  - `cli.ts` — CLI（子命令 login/mcp/get/set/action/statistics/run + 全局参数）
  - `mcp.ts` — MCP server（@modelcontextprotocol/sdk，13 个工具）
  - `cookies.ts` — 登录用的 CookieJar / 手动跟随重定向
  - `version.ts` — 版本单一来源（发布时与 `docs/package.json` 同步改）
- `tests/` — `bun test`；`miutils.test.ts` 用 `reference.json`（Python 生成的基准向量）逐项对照
- `archive/` — 原 Python 实现（只读参照，用于生成测试基准）
- `docs/` — 独立的 pnpm + VitePress 站点
- `skills/SKILL.md` — agent skill（CLI 指南）

## 开发环境

Bun 直接运行 TS，无需编译步骤。npm 走全局 `~/.npmrc` 的 npmmirror 镜像（不要改成官方源）。

```bash
bun install                # 装依赖
bun test                   # 跑测试（miutils 向量对照）
bun src/cli.ts --version   # 运行 CLI
bun run cli -- --get_device_info yeelink.light.lamp4   # 无需认证，可离线验证
bun src/mcp.ts -p <auth>   # 启动 MCP server（stdio，阻塞）
bunx tsc --noEmit          # 类型检查（较慢，见 Pitfalls）
```

## 构建与发布

无构建步骤；CLI 直接 `bun src/cli.ts`。如需单二进制分发给无 bun 的机器：

```bash
bun build --compile src/cli.ts -o dist/home-ai   # 输出单文件可执行
```

## 约定

- 公共 API 方法名保持 snake_case（`get_homes_list`、`run_scene` 等），与文档/Python 版一致。
  但 TS 网络是异步，设备操作用 async：`await device.get("brightness")`，不复刻 Python 的
  `device.brightness` 魔法属性。
- 类名 `mijiaAPI`/`mijiaDevice` 保持；用户/模块内字符串用中文（沿用 Python 版风格）。
- 版本单源 `src/version.ts`，发布时与 `docs/package.json` 同步。
- 错误类在 `errors.ts`（APIError/LoginError/Device*），映射 `ERROR_CODE` 中文表。
- 请求加密逻辑集中在 `apis.ts` 的私有 `request()`：data JSON → nonce → 双层签名 →
  RC4 加密 → form POST；失败时 `decrypt()` 解响应。改动加解密务必跑 `bun test` 对照基准。

## 陷阱

- `bunx tsc --noEmit` 会被 @modelcontextprotocol/sdk 巨型类型定义拖慢甚至会 OOM；改用
  运行时验证（`bun test` + 实际跑 `bun src/cli.ts` 子命令）作为主要门禁。
- 登录/MCP 无法在本机无账号时端到端测试——需要真实米家账号扫码。密码学层已由
  `reference.json` 对照覆盖；改登录流程后要谨慎。
- `--get_device_info` 无需认证，可用来快速验证 `getDeviceInfo` 解析与网络。
- `archive/` 是 Python 参照；不要手动编辑它，它是测试基准的来源（改算法后要同步重新生成
  `tests/reference.json`）。
- 认证路径是 `~/.config/mijia-api/auth.json`（保留，勿改）；环境变量 `MIJIA_LOG_LEVEL`
  控制日志级别。
- npm 源必须是镜像；`bun install` 失败多半是网络，先确认 `~/.npmrc`。
