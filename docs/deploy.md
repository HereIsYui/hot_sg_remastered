# 部署文档（docker/prod 一键启动）

对应开发计划阶段 11「发布」项（design/02-开发计划.md:336）：Docker Compose 一键启动、存档备份/恢复脚本、部署与开发文档。桌面壳（Tauri/Electron）是计划中的可选项，本轮未做。

## 架构

```
浏览器
  │  http://<host>:8080
  ▼
web（nginx，静态托管两个 vite 产物）
  ├── /          客户端 apps/client/dist
  ├── /gm/       GM 后台 apps/gm/dist（vite build --base=/gm/）
  ├── /assets/   原版美术素材（apps/client/public/assets，构建时打进镜像）
  ├── /api/…  ──proxy──▶ server（NestJS，node dist/main.js，容器内 3000）
  └── /ws     ──proxy ws──▶ server（push WebSocket，聊天/战报推送）
                                  │
                                  ▼
                            db（MySQL 8.4，容器内 3306）
```

客户端的 push 连接是同源 `ws(s)://<host>/ws?uid=…&sid=…`（apps/client/src/game/game.ts:220-225 取 `window.location.host` 加 `PUSH_ENDPOINT`，后者定义在 packages/shared/src/protocol/push.ts:60），所以对外只需要一个 web 端口。原版独立的聊天端口（5308/7308，app-config.ts 的 `CHAT_PORT`/`CHIBI_CHAT_PORT`）只是回传给客户端的数据，重制版推送统一走 `/ws`。

## 三个数据库，谁需要备份

| 库 | compose | 版本 | 用途 | 备份？ |
|---|---|---|---|---|
| 生产栈 `hot-prod` 的 db | docker/prod | MySQL 8.4 | 部署的存档数据 | **要**（`pnpm db:backup`） |
| 开发库 | docker/dev（宿主机 127.0.0.1:3318，hot/hot） | MySQL 8.4 | 日常开发，可随时 `db:migrate` 重建 | 可选（`pnpm db:backup --dev`） |
| 差分基线库 | docker/legacy（127.0.0.1:3317） | MySQL 5.7 | 差分测试的对照 oracle | **不备份**。它由原版素材可复现（`pnpm legacy:dump-db`），且 8.4 的 utf8mb4/InnoDB 备份不能还原回 5.7 的 utf8/MyISAM 形态；`legacy:up` 会直接从 legacy/db/bloodwar_full.sql 重新导入 |

## 快速开始

宿主机需要 Docker（含 compose v2）。Node/pnpm 只在生成原版素材的机器上需要（见下节）。

```bash
# 1. 配置（端口、密码、GM token；全部有默认值，可先不填）
cp docker/prod/.env.example docker/prod/.env

# 2. 构建镜像并启动（db + server + web，等全部健康检查通过）
pnpm prod:up
# 等价：docker compose -f docker/prod/docker-compose.yml up -d --build --wait

# 3. 初始化数据库（见「数据库初始化」；已有备份则 pnpm db:restore <file>）

# 4. 打开
#    客户端   http://<host>:8080/
#    GM 后台  http://<host>:8080/gm/
#    健康检查 http://<host>:8080/api/health
```

停止：`pnpm prod:down`（保留数据卷）。**删除数据卷**：`docker compose -f docker/prod/docker-compose.yml down -v` — 存档彻底清空，先备份。

### 镜像加速

Docker Hub 慢时设置 `HOT_DOCKER_MIRROR`（沿用 docker/legacy/docker-compose.yml 的约定），`docker/prod/.env` 里取消注释：

```
HOT_DOCKER_MIRROR=docker.m.daocloud.io/library/
```

## 原版素材与文案（不在 git 里）

仓库不含任何原版内容（.gitignore 排除 `/legacy/` 与 `apps/client/public/assets/`）。完整体验需要先在有原版安装包 `start.exe` 的机器上生成：

```bash
pnpm install
pnpm legacy:extract   # 解包到 legacy/raw/
pnpm legacy:assets    # 美术素材 → apps/client/public/assets/（构建镜像时打进 web）
pnpm legacy:lang      # 服务端文案 → legacy/lang/zh_CN.json（运行时挂载进 server）
pnpm legacy:dump-db   # 原库 SQL → legacy/db/bloodwar_full.sql（数据库初始化用）
```

缺少它们时的降级（不算故障）：

- 无 `apps/client/public/assets` → 镜像能构建、页面能开，但游戏无美术资源；
- 无 `legacy/lang/zh_CN.json` → server 正常启动，游戏文案回退为 key（apps/server/src/common/lang.service.ts:11-15 会打 warning）；
- `legacy/db/bloodwar_full.sql` 缺失 → 无法初始化数据库（见下节）。

建议在有素材的机器构建镜像（`docker compose -f docker/prod/docker-compose.yml build`），再推到部署机（`docker save`/私有 registry），部署机无需 Node 与原版素材。

## 数据库初始化

新数据卷是空库，需要导入迁移后的原库数据：

```bash
# 在有原版素材的机器上生成迁移后的 8.4 语法 dump：
pnpm db:up && pnpm db:migrate     # legacy/db/bloodwar_full.sql → legacy/db/bloodwar_mysql84.sql
```

然后任选其一：

```bash
# a) 恢复脚本导入（推荐，compose 目标可选 prod/dev）：
pnpm db:restore legacy/db/bloodwar_mysql84.sql

# b) 直接用原始 5.x dump：恢复脚本检测到 MyISAM/utf8 形态时，
#    会用 tools/src/lib/migrate-sql.ts 的同一套 migrateDump() 在线转换
#    （ENGINE=InnoDB、utf8mb4_general_ci/bin、导入序言/尾声 mem_maneuver 补列），
#    与 pnpm db:migrate 的口径一致：
pnpm db:restore legacy/db/bloodwar_full.sql
```

两者都会重建库（DROP + CREATE，utf8mb4 / utf8mb4_general_ci，GRANT 给 app 用户），导入后校验全部表为 InnoDB 且表数与 dump 一致。

## 备份与恢复

```bash
pnpm db:backup                     # 生产栈 → backups/bloodwar-YYYYmmdd-HHMMSS.sql.gz，默认保留 14 份
pnpm db:backup --dev               # 开发库（3318）
pnpm db:backup --keep 30 --out /var/backups/hot
pnpm db:restore backups/bloodwar-20260101-040000.sql.gz   # 不带参数则取最新一份
```

- 备份走 `docker compose exec`，用容器内的 `MYSQL_ROOT_PASSWORD`/`MYSQL_DATABASE`，跟随 .env；`--single-transaction`（全 InnoDB 后一致性快照不锁表）、`--default-character-set=utf8mb4`。
- 恢复是破坏性的（先 DROP 库）；恢复后如需彻底重置服务端连接状态，`docker compose -f docker/prod/docker-compose.yml restart server`。
- 定期备份，用 crontab（每天 04:17）：

```cron
17 4 * * * cd /opt/hot && bash scripts/backup-db.sh >> backups/backup.log 2>&1
```

或 systemd timer（等价）：

```ini
# /etc/systemd/system/hot-backup.service
[Unit]
Description=hot bloodwar database backup

[Service]
Type=oneshot
WorkingDirectory=/opt/hot
ExecStart=/usr/bin/env bash scripts/backup-db.sh

# /etc/systemd/system/hot-backup.timer
[Unit]
Description=daily hot bloodwar backup

[Timer]
OnCalendar=*-*-* 04:17:00
Persistent=true

[Install]
WantedBy=timers.target
```

`backups/` 下产物被 .gitignore 的 `*.sql.gz` 排除；恢复脚本对差分基线库（docker/legacy）没有也不应有入口，理由见上文表格。

## 环境变量

`docker/prod/.env.example` 是完整清单，分三类：

**compose 栈本身**

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOT_DOCKER_MIRROR` | 空 | Docker Hub 镜像前缀，如 `docker.m.daocloud.io/library/` |
| `HOT_WEB_PORT` | 8080 | 对外唯一入口（nginx） |
| `HOT_SERVER_PORT` | 3000 | server 直连端口，只绑 127.0.0.1（调试用） |
| `HOT_DB_PORT` | 3319 | db 直连端口，只绑 127.0.0.1（运维用；避开 dev 3318 / legacy 3317） |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | hot / hot / hot / bloodwar | 建库凭据；`DATABASE_URL` 由 compose 拼接。外网部署务必改密码（限字母数字） |

**游戏服务端**（schema 见 apps/server/src/config/app-config.ts）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TICK_ENABLED` | true | 结算循环总开关；维护窗口临时关停用，平时保持 true |
| `TICK_INTERVAL_MS` | 3000 | 结算节拍（对应原版 cfg_js.php 每 3 秒） |
| `DATABASE_POOL_SIZE` | 10 | mysql 连接池 |
| `LOG_JSON` | false | JSON 日志（便于采集） |
| `WORLD_REFRESH_ENABLED` | true | 8 小时野地刷新任务 |
| `SERVER_MARK` / `SERVER_NAME` | hot | loadGlobalData 回传客户端的服务器标识（原版 config/db.php） |
| `GM_TOKEN` | 空 | GM API 的 `x-gm-token` 校验（apps/server/src/gm/gm-token.guard.ts:15）；**留空 = /api/gm 全部 403** |
| `LANG_FILE` | /repo/legacy/lang/zh_CN.json | compose 已把 `../../legacy/lang` 只读挂载到该路径，一般不用改 |
| `TICK_DEBUG_ENDPOINT` | — | compose 里写死 `false`：该端点是差分测试专用钩子，生产不开 |

**构建期打进前端包**（改动后需 `pnpm prod:up` 重建 web 镜像）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_GM_TOKEN` | 空 | 编译进 gm 包、随请求头发送；必须与服务端 `GM_TOKEN` 一致。注意它会出现在浏览器可见的 bundle 里，只适合个人/内网部署 |
| `VITE_ASSET_URL` | /assets/ | gm 预览宝物图片的地址；nginx 已把客户端素材托管在同源 /assets/ |
| `VITE_REGISTER_URL` / `VITE_HOME_LABEL` / `VITE_HOME_URL` | 空 | 登录页注册/官网按钮（留空隐藏，apps/client/src/views/LoginView.vue:25-27） |

## 日常运维

```bash
docker compose -f docker/prod/docker-compose.yml ps         # 状态（三服务应 healthy/running）
docker compose -f docker/prod/docker-compose.yml logs -f server
pnpm prod:up                                                # 拉新代码后重建并滚动更新
docker compose -f docker/prod/docker-compose.yml build      # 只重建镜像（离线打包用）
```

- 更新发布：`git pull`（或在有素材的机器重新 build/save 镜像）→ `pnpm prod:up`。数据在 `hot-prod_db-data` 卷中，重建容器不丢数据。
- 健康检查：db 用 `mysqladmin ping`，server 用 `GET /api/health`，web 依赖 server 健康。
- 常见问题：
  - 端口占用 → 改 `.env` 的 `HOT_WEB_PORT`/`HOT_SERVER_PORT`/`HOT_DB_PORT`；
  - `lower_case_table_names` 报错 → 该参数只能在初始化时设定（docker/dev/docker-compose.yml:17 注释），换数据卷名或 `down -v` 重建；
  - GM 后台提示「未配置 VITE_GM_TOKEN」→ `.env` 填好两端 token 后重建 web 镜像。

## 与 dev / legacy compose 的关系

- `docker/dev`（38 行）：仅 MySQL 8.4 开发库，`pnpm db:up`；生产 db 服务沿用其全部 MySQL 参数（lower-case-table-names=1、空 sql-mode、utf8mb4_general_ci、+08:00）。
- `docker/legacy`（79 行）：原版 PHP + MySQL 5.7 对照环境，头部即注明 "never deployed"，只服务差分测试，不进生产链路。
- `docker/prod`：本轮新增的一键全栈（db + server + web，含 push 端口经 nginx 升级转发）。
