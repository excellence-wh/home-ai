# 安装

> 要求 [Bun](https://bun.sh) >= 1.0（本仓库为 TypeScript 实现，Bun 直接运行 TS，无需编译）

## 从源码运行（推荐）

```bash
git clone https://github.com/excellence-wh/home-ai.git
cd home-ai
bun install        # 安装依赖
bun src/cli.ts --version   # 验证
```

## 全局安装（可选）

让 `home-ai` 命令全局可用：

```bash
bun install
bun link
home-ai --version
```

## 单二进制（可选，给没有 bun 的机器）

```bash
bun build --compile src/cli.ts -o ~/bin/home-ai
```

## 注意

- 原 Python 发布（PyPI `mijiaAPI` / `pip install`）已不再维护；本仓库为 Bun/TS 版。
- npm 依赖在镜像源可用时安装更快（本仓库 `~/.npmrc` 已指向 npmmirror）。
