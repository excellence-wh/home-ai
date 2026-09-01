# home-ai

米家 API，可以使用代码、CLI、MCP 直接控制米家设备。

> 🎉 **v0.1.0**：支持 MCP 与 Agent Skill，详见 `skills/SKILL.md` 与 `mcp` 子命令。

本仓库是 [Do1e/mijia-api](https://github.com/Do1e/mijia-api) 的自主维护分支，替换了包名/CLI 并重置版本；底层全部能力与原项目保持一致，许可证仍为 GPL-3.0。

[![GitHub](https://img.shields.io/badge/GitHub-excellence--wh%2Fhome--ai-blue)](https://github.com/excellence-wh/home-ai)
[![PyPI](https://img.shields.io/badge/PyPI-home--ai-blue)](https://pypi.org/project/home-ai/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg)](https://opensource.org/licenses/GPL-3.0)

## 安装

> 要求 Python >= 3.10

```bash
pip install home-ai
# Or `uv add home-ai` for uv users
```

## 快速开始

```python
from home_ai import mijiaAPI, mijiaDevice

# 初始化并扫码登录（认证文件默认保存在 ~/.config/mijia-api/auth.json）
api = mijiaAPI()
api.login()

# 通过设备名称控制设备（推荐）
device = mijiaDevice(api, dev_name="我的台灯")
device.on = True              # 打开设备
device.brightness = 60        # 设置亮度为 60%

# 查看设备支持的所有属性和动作
print(device)
```

CLI 用法：

```bash
home-ai login                          # 扫码登录
home-ai -l                             # 列出所有设备
home-ai set --dev_name "台灯" --prop_name "brightness" --value 60
```

MCP 用法：

执行 `uvx home-ai login -p /path/to/auth.json` 登录后，在 MCP 客户端配置中添加以下内容即可接入米家：

```json
{
  "mcpServers": {
    "home-ai": {
      "command": "uvx",
      "args": ["home-ai", "mcp", "-p", "/path/to/auth.json"]
    }
  }
}
```

更多用法（API 基础调用、MCP Server、CLI 完整参数、最佳实践等）请查阅 `docs/` 目录（VitePress 站点）与上方上游文档链接。

## 致谢

* [janzlan/mijia-api](https://gitee.com/janzlan/mijia-api/tree/master)
* [Do1e/mijia-api](https://github.com/Do1e/mijia-api)（本项目源自它）
* [米家 APP 网络请求的抓包、加解密与构造的代码笔记](https://imkero.net/posts/mihome-app-api/)
* [al-one/hass-xiaomi-miot](https://github.com/al-one/hass-xiaomi-miot)

## 开源许可

本项目采用 [GPL-3.0](LICENSE) 开源许可证。

**请注意：GPL-3.0 是具有“强传染性”的开源许可证。**
如果您在您的项目中使用、修改或分发本项目的代码（包括作为库依赖），您的整个项目也**必须**以 GPL-3.0 或兼容许可证开源发布。

## 免责声明

* 本项目仅供学习交流使用，不得用于商业用途，如有侵权请联系删除
* 用户使用本项目所产生的任何后果，需自行承担风险
* 开发者不对使用本项目产生的任何直接或间接损失负责
