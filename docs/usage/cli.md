# CLI 命令行

`home-ai` 提供了命令行工具，可以直接在终端中控制米家设备，无需编写 Python 代码。

## 主命令帮助

```bash
home-ai --help
```

## 环境变量

支持以下环境变量来配置 CLI 的行为：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `MIJIA_LOG_LEVEL` | `INFO` | 日志级别，可选值：`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |

### 示例

```bash
# 设置为 DEBUG 级别查看详细日志
export MIJIA_LOG_LEVEL=DEBUG
home-ai --list_devices

# 或直接在命令前指定
MIJIA_LOG_LEVEL=WARNING home-ai get --dev_name "卧室台灯" --prop_name "brightness"
```

## 子命令

CLI 包含以下子命令：

| 子命令 | 说明 |
|--------|------|
| `login` | 二维码登录米家账号 |
| `get` | 获取设备属性 |
| `set` | 设置设备属性 |
| `action` | 按动作名执行设备动作 |
| `statistics` | 获取设备统计数据 |
| `run` | 使用自然语言描述需求（通过小爱音箱执行） |
| `mcp` | 启动 MCP server（stdio 传输） |

## 获取设备属性

```bash
# 查看帮助
home-ai get --help

# 获取设备属性
home-ai get --dev_name "卧室台灯" --prop_name "brightness"

# 指定认证文件路径
home-ai get -p /path/to/auth.json --dev_name "卧室台灯" --prop_name "on"
```

## 设置设备属性

```bash
# 查看帮助
home-ai set --help

# 设置设备属性
home-ai set --dev_name "卧室台灯" --prop_name "brightness" --value 60

# 打开设备
home-ai set --dev_name "卧室台灯" --prop_name "on" --value True
```

## 执行设备动作

```bash
# 无参数动作
home-ai action --dev_name "卧室台灯" --action_name toggle

# 带参数动作，--params 必须是 JSON 对象
home-ai action --did 123456 --action_name execute-text-directive --params '{"in":["打开空调",1]}'
```

动作名可通过 `--get_device_info MODEL` 获取。`--did` 和 `--dev_name` 必须且只能提供一个。

## 获取统计数据

```bash
# 默认查询最近 30 天，最多返回 6 条
home-ai statistics --did 123456 --key 7.1 --data_type stat_month_v3

# 指定条数和时间范围（Unix 时间戳，秒）
home-ai statistics --did 123456 --key 7.1 --data_type stat_day_v3 \
  --limit 30 --time_start 1700000000 --time_end 1702592000
```

常用统计类型为 `stat_hour_v3`、`stat_day_v3`、`stat_week_v3`、`stat_month_v3`；较旧设备
可能使用不带 `_v3` 的对应类型。统计能力和 `key` 因设备型号而异：例如
`lumi.acpartner.mcn04` 的耗电量使用 `7.1`，`lumi.acpartner.mcn02` 使用 `powerCost`。

命令原样输出 API 返回的 JSON。每项通常包含 Unix 秒级时间戳 `time` 和字符串 `value`；
`value` 可能仍是 JSON 数组字符串，例如 `"[48.476]"`，解析时使用 JSON 解析器。不同型号可能使用不同统计 API，详见
[issue #46](https://github.com/excellence-wh/home-ai/issues/46) 和
[米家统计接口文档](https://iot.mi.com/new/doc/accesses/direct-access/extension-development/extension-functions/statistical-interface)。

## 常用命令示例

```bash
# 列出所有设备（首先需要这个来获取设备名称）
home-ai -l

# 列出所有家庭
home-ai --list_homes

# 列出所有场景
home-ai --list_scenes

# 执行场景
home-ai --run_scene "睡眠模式" "晚安"

# 获取设备规格信息
home-ai --get_device_info yeelink.light.lamp4

# 列出耗材
home-ai --list_consumable_items

# 执行设备动作
home-ai action --dev_name "卧室台灯" --action_name toggle

# 获取统计数据
home-ai statistics --did 123456 --key 7.1 --data_type stat_month_v3

# 使用小爱音箱执行自然语言命令
home-ai run "打开卧室台灯"
home-ai run "把亮度调到50%" --wifispeaker_name "卧室小爱"
home-ai run "关闭所有灯" --quiet
```

## 全局安装 / 免安装运行

在仓库内 `bun install` 后 `bun link`，`home-ai` 命令全局可用；或直接：

```bash
bun <repo路径>/src/cli.ts --help
bun <repo路径>/src/cli.ts -l
bun <repo路径>/src/cli.ts get --dev_name "台灯" --prop_name "brightness"
```

::: tip
完整的命令行参数说明请参考 [CLI 参数参考](/reference/cli-args)。
:::
