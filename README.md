# 热血三国单机版 H5 重制（hot_sg_remastered）

把基于 Flash 的《热血三国》1.12 单机版重制为现代浏览器可运行的 H5 版本：

- 客户端：TypeScript + Vite + Vue 3 + PixiJS，设计分辨率 1000×600，沿用原版美术素材。
- 服务端：Node.js + NestJS，按模块重写原 PHP 业务逻辑，沿用原 MySQL 数据库结构。
- 原版 PHP 服务端在 Docker 中原样运行，作为差分测试的对照基准。

## 文档

- [项目分析](design/01-项目分析.md)：原版安装包结构、通信协议、客户端 / 服务端 / 数据库 / 素材分析、技术选型。
- [开发计划](design/02-开发计划.md)：目标架构、模块迁移清单、阶段计划与工期、风险。
- [数据库词条解释](docs/热血三国数据库词条解释.txt)：社区整理的部分数据表含义。
- [接口清单](design/接口清单.md)、[界面清单](design/界面清单.md)、[数据字典](design/数据字典.md)：由 `pnpm legacy:inventory` 从原版代码和数据库生成的迁移范围基线。

## 原版文件

本仓库 **不包含任何原版内容**（安装包、素材、反编译代码、数据库数据）。开发前需要：

1. 自备原版单机安装包 `start.exe`，放在仓库根目录（已在 `.gitignore` 中排除）。
2. 运行 `tools/` 中的脚本，在本地生成 `legacy/`（解包文件、反编译源码、原库 SQL）和客户端素材。

## 快速开始

需要 Node.js 22.18+（推荐 24）、pnpm 10、Docker。

```bash
pnpm install

# 从 start.exe 提取原版资料（结果都在 .gitignore 中）
pnpm legacy:extract     # 解包到 legacy/raw/
pnpm legacy:dump-db     # 用临时 MySQL 5.7 容器把原库导出为 legacy/db/*.sql
pnpm legacy:decompile   # FFDec 反编译四个 SWF 到 legacy/decompiled/
pnpm legacy:assets      # 导出图片与 SWF 位图、精灵到 apps/client/public/assets/
pnpm legacy:inventory   # 重新生成 design/ 下的接口清单、界面清单、数据字典

# 原版对照环境：PHP 5.6 + MySQL 5.7 + 每 3 秒一次结算
pnpm legacy:up          # JSON 网关 http://127.0.0.1:8090/server/amfphp/json.php，MySQL 127.0.0.1:3317
pnpm legacy:smoke       # 登录并调用命令，确认对照环境可用
pnpm legacy:down        # 停止（legacy:reset 会同时删除数据卷，下次启动重新导入）

# 开发
pnpm dev:server         # http://localhost:3000/api/health
pnpm dev:client         # http://localhost:5173
pnpm test && pnpm typecheck && pnpm lint
```

Docker Hub 访问慢时设置镜像前缀，例如 `export HOT_DOCKER_MIRROR=docker.m.daocloud.io/library/`；脚本和 `docker compose` 都会读取它。FFDec 首次使用时会自动下载到 `legacy/.cache/`，本机没有 Java 时通过 Docker 运行。

## 目录约定

```
apps/server      NestJS 服务端
apps/client      H5 客户端
apps/gm          GM 后台
packages/shared  前后端共享的协议类型、常量、文案
tools/           解包、素材导出、数据迁移、差分测试脚本
design/          设计文档
docs/            参考资料
legacy/          本地生成的原版文件（不提交）
```

## 说明

原游戏的代码与美术版权归原开发商所有。本项目仅用于个人学习与单机怀旧，不用于商业用途。
