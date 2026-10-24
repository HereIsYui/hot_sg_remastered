# 热血三国单机版 H5 重制（hot_sg_remastered）

把基于 Flash 的《热血三国》1.12 单机版重制为现代浏览器可运行的 H5 版本：

- 客户端：TypeScript + Vite + Vue 3 + Pinia + PixiJS，设计分辨率 1000×600，沿用原版美术素材。
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
pnpm legacy:assets      # 导出图片、SWF 位图与精灵、客户端文案到 apps/client/public/assets/，
                        # 并生成 embeds.json（原 Embed 路径 -> 文件）、slices.json（九宫格）
pnpm legacy:ui          # 界面结构提纲写到 legacy/ui/，全局 Flex 样式表写到 assets/styles.json
pnpm legacy:inventory   # 重新生成 design/ 下的接口清单、界面清单、数据字典

# 原版对照环境：PHP 5.6 + MySQL 5.7 + 每 3 秒一次结算
pnpm legacy:up          # JSON 网关 http://127.0.0.1:8090/server/amfphp/json.php，MySQL 127.0.0.1:3317
pnpm legacy:smoke       # 登录并调用命令，确认对照环境可用
pnpm legacy:down        # 停止（legacy:reset 会同时删除数据卷，下次启动重新导入）

# 开发库：MySQL 8.4，127.0.0.1:3318（hot/hot）
pnpm legacy:lang        # 用原版 PHP 求值 lang.php，生成 legacy/lang/zh_CN.json（服务端文案）
pnpm db:up              # 启动开发库
pnpm db:migrate         # 把 legacy/db/bloodwar_full.sql 转成 8.4 语法并导入（会重建库）
pnpm db:codegen         # 表结构变化后重新生成 apps/server/src/db/schema.generated.ts

# 开发
pnpm dev:server         # http://localhost:3000/api/health
pnpm dev:client         # http://localhost:5173，/api 代理到 3000；需先运行 legacy:assets 与 legacy:ui
pnpm test && pnpm typecheck && pnpm lint

# 差分测试：同一组请求分别发给原版与新服务端，比对返回值和数据库变更
pnpm difftest                 # 全部用例；pnpm difftest createRole 只跑名称包含该词的用例
pnpm difftest --resnapshot    # 两边数据库重新导入后，重建快照
```

差分测试要求两边数据库从同一份导出开始：先 `pnpm legacy:reset && pnpm legacy:up`、`pnpm db:migrate`，再立即运行（原版的结算进程会改动数据，`difftest` 启动时会先停掉它）。首次运行会把每张表复制成 `__snap_*` 快照表，每个用例结束后按快照回滚，因此可以重复运行。新服务端由脚本以 `TICK_ENABLED=false` 在 3998 端口启动，日志在 `legacy/.cache/difftest-server.log`。

客户端登录页的“注册”“官网”按钮默认隐藏，在 `apps/client/.env.local` 中设置 `VITE_REGISTER_URL`、`VITE_HOME_LABEL`、`VITE_HOME_URL` 后显示。

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

## 开发进度

阶段划分见 [开发计划](design/02-开发计划.md) 第 7 节。每完成一个功能点就单独提交并推送到 `main`，提交历史就是最细的进度记录（`git log --oneline`）。

| 阶段                                                                                   | 状态       |
| -------------------------------------------------------------------------------------- | ---------- |
| 0 基础设施与资料提取                                                                   | 完成       |
| 1 后端基础框架（命令网关、会话、用户锁、Tick、推送骨架、登录与创建角色、差分测试工具） | 完成       |
| 2 前端框架（舞台、素材加载、Fx 皮肤组件、DialogManager、登录到主界面）                 | 完成       |
| 3 城池经济                                                                             | 完成       |
| 4 将领与道具（主体完成，剩余见下）                                                     | 完成       |
| 5 世界与战斗（波 1–4 完成；占城抓将未比对）                                            | **进行中** |
| 6–11 社交、成长、活动、独立战场、GM、发布                                              | 未开始     |

### 阶段 3 已完成

城池加载与 `CityCommand` 轮询、信息面板；建筑建造 / 升级 / 拆除与队列；书院科技与研究结算；兵营造兵、遣散（二级密码）、兵种转换；城墙城防与结算；天灾人祸结算、排行重建与排行奖励；官府（税率、安抚、征收、改名、生产率、建筑总览）；城池列表与废弃城池；附属野地列表与详情、资源地转换；任务对话框与任务奖励、君主任务刷新；新手引导。

### 阶段 4 已完成

- 宝物对话框：物品列表、使用礼包与礼匣、出售。
- 物品加速（鲁班 / 墨家道具）、增益道具（神农锄、鲁班斧、战鼓、阵图、青囊书、徭役令、推恩令、典民令、安民告示等）、默认宝箱。
- 客栈：招募列表、刷新、招募将领、招贤榜。
- 将领详情：升级、加点、洗点、改名、赏赐、解雇。
- 将领装备：穿戴、卸下、修理、修复（元宝 / 礼金）、一键修理 / 修复 / 卸下。
- 将领技能：领悟、穿戴 / 卸下技能书；宝物里的「技能书」页（筛选、回收、扩充书栏）。

代码里尚未移植的分支都会抛出 `... not ported` 错误或显示 `NotYetValid` 提示，可用 `rg "not ported|NotYetValid" apps` 查找。其中委托任务、世界事件任务、名将任务、洛阳相关奖励属于后续阶段。

- 将领技能：领悟、穿戴 / 卸下技能书；宝物里的「技能书」页（筛选、回收、扩充书栏）。
- 将领详情按钮：体力 / 精力药、经验书、统率 / 攻击 / 防御宝物，俘虏招降 / 释放，投奔接纳 / 回绝，名将说明，君主改名。
- 将领历练：开始、取消、加速、结算、奇遇。
- 铁匠铺：强化、打孔、镶嵌、合成、技能书合并；打孔器、化石粉在铁匠铺内可用。
- 商城：元宝 / 礼金购买、限购、买了就用、礼券兑换；物品不足时弹出购买框。
- 特殊物品：旌旗、名帖（含君主改名）、盟主令、武器架、打孔器、化石粉。
- 客栈：招募、结交名将、市井传闻（服务端与对话框）、鉴定宝藏、五铢钱商店。
- 仓库打包资源、粮仓查看与卸下、将领「宝物」按钮（增益、倒计时、续买）。

### 阶段 4 剩余（未做）

1. 君主「学习」面板、君主经验书、君主战术。
2. 坐骑相关：粮仓的激活、强化、升级；铁匠铺的洗练、熔炼、装备升级三个页签，目前显示"暂未开放"。
3. 客栈：查看名将详情、领取任务暂未开放；名将任务与传闻里的任务、军队依赖后续阶段；游说原版即关闭，未做。
4. 迁城令、免战牌、离间符：依赖出征与战斗，入口尚未接入。
5. 武魂（卡在成就扣物品一步）、卡牌合成（原版单机关闭）。
6. 将领历练的活动奇遇、君主历练的开始；活动招将（平时无活动，未做）。

### 阶段 5 进行中

已完成，差分测试 104/104 全过：

- 波 1：世界后端与地图（地块与城查询、收藏、标记、搜索、管辖信息）、校场（伤兵、俘虏、逃兵、攻防战术、征兵、演习）、邮件（收件、发件、系统信）。
- 波 2：出征（发兵、方案、召回、踢出）、军队列表与详情、军队到达后的回城、运输、派遣。
- 波 3：战报列表与详情、战斗框、敌军来袭报警；测试工具固定随机数（`s.rng` / `s.seed` / `s.stopRng`）；侦察、掠夺、占领、攻击。
- 野地守军再生（`checkSodier`）、NPC 城建城防、占领 NPC 城。
- 兵种战术加成照原版补全；占领野地后城的产出加成同步变化。
- 波 4 服务端：野地建城（`createCityFromLand`，含驻军并入、爵位/资源校验）、政令（`governOthers` 征税/抽丁/征粮/收编/裁军）、合城（`mergeCity`，分城折算升级主城建筑、25 表拆分、名城契约）。
- 波 4 客户端：野地详情「筑城」入口与确认流程（世界地图自有平地 → 进入 → 筑城，浏览器实测通过）；顺带修复出征任务 ID 映射错误与 WorldPanel 三个错键文案。

剩余（未做或未比对）：

1. 占城、抓将：只有单元测试，差分测试未比（一回合约 25 秒，守军打不完）。
2. 占城后拆建筑、最后一座城被占迁城：未比对。
3. 侦察时对方有巡逻兵，先打一仗：未做。侦察只有差分测试，没有单元测试。
4. 野地 8 小时刷新：按数据表猜写，原版无源码，与原版可能不同。
5. 政令（GovernPanel）、合城（CityMergeDialog）的客户端对话框未移植。
6. 掉物品、荣誉、将领血量、联盟战报、联盟群发与援助、宣战、洛阳出兵、自动运输：未做。
7. 数据库随机排序（`order by rand()`）需在用例里逐例固定；「新角色落地」「释放俘虏到野地」偶尔不过。

## 开发流程

每个功能点按同样的步骤推进：

1. **读原版**：
   - PHP 在 `legacy/raw/APMServ5.2.6/www/htdocs/server/game/*.php`；
   - AS3 在 `legacy/decompiled/BloodWar/scripts/<模块>/*.as`（例如 `Hero/HeroDetailDialog.as`）；
   - 界面提纲在 `legacy/ui/BloodWar/<模块>/*.txt`，坐标、尺寸、样式名都照抄；
   - 客户端文案在 `apps/client/public/assets/lang/zh_CN.json`，服务端文案在 `legacy/lang/zh_CN.json`。
2. **服务端**：在对应模块里写命令类，加入模块的 `providers`。
3. **差分测试**：在 `tools/src/difftest/cases.ts` 末尾加用例，覆盖成功路径和各个错误分支，`pnpm difftest "用例名"` 通过后再跑全部用例。
4. **客户端**：纯逻辑放 `apps/client/src/game/*.ts` 并写 `*.test.ts`，界面放 `apps/client/src/views/<模块>/`。
5. **检查**：`pnpm exec prettier --write <改动的文件>`，然后 `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`。
6. **浏览器实测**：启动开发服务，用 Playwright 脚本走一遍流程并截图，测完把测试数据恢复原样（见下文）。
7. **提交并推送**到 `main`。提交信息说明这一步做了什么，**不要带 `Co-authored-by: Cursor` 之类的署名**。

### 服务端约定

- 命令用 `@GlobalCommand()` / `@DialogCommand()` 注册，方法签名 `(ctx, param)`，按方法名路由；注册表就是原版的 `openfunc` 白名单。
- 原版 `function f($uid, $param)` 一对一改写，查询用 Kysely 的 `sql` 模板照搬原 SQL，并改为参数绑定。需要多条写入时包在 `this.scope.transaction` 里。
- 错误：`GameError.lang('分组.键', ...参数)` 对应原版 `$GLOBALS[...]` 文案，`GameError.raw(msg)` 用于原样字符串（如 `not_enough_goods10668`，客户端会弹出购买框）。
- PHP 语义用 `core/php.ts` 中的 `phpIntval`、`phpNum`、`phpEmpty`、`phpLooseEquals` 等复现，不要自己用 JS 隐式转换。
- 随机数统一走 `RandomService`（`mtRand` / `rand`），差分测试才能固定结果。
- 常用公共服务：`OwnershipService`（城池 / 将领归属）、`CityRules`（资源增减、产量刷新）、`HeroRules`（重算属性、俸禄）、`GoodsRules`（扣物品）、`TaskRewards.addMoney`（元宝与日志）、`CityInfoService`（返回给客户端的城池 / 将领数据）。
- 与原版不同的地方要有意为之：例如补上归属校验、给查询加确定性的 `order by`（原库是 MyISAM，开发库是 InnoDB，行序可能不同）。

### 差分测试要点

- 每次运行开始时两边都回滚到快照，每个用例结束后也会把它改动过的表回滚，所以用例之间互不影响；用例需要的数据在用例里自己插入（用 9000xx 一类不冲突的 id）。
- `s.command(session, 函数名, ...参数)` 发命令，`s.query` 比对数据库；行序不稳定的结果用 `s.unordered(...路径)`，时间戳等不确定字段用 `s.mask(...路径)`。
- 有随机的命令，把对应配置表临时改成确定值（如把 `cfg_skill_rate` 固定为某个技能），在 `finally` 中还原。
- `--dump` 会把两边的返回写到 `legacy/.cache/difftest-*.json`，用来定位差异。
- `pnpm difftest` 会先构建服务端；只改了 tools 时可以 `pnpm --filter @hot/tools difftest`。

### 客户端约定

- 照原版组件结构拆分：一个 AS3 对话框对应一个 `.vue`，方法上的注释写出对应的原版函数名（如 ``/** `onClickSell` */``）。
- 界面只用 `ui/` 下的 Fx 组件（`FxCanvas`、`FxButton`、`FxImage`、`FxLabel`、`FxText`、`FxToggle`、`FxComboBox`、`FxDataGrid` 等），用原版的 `x/y/w/h` 和 `style-name`。
- 通信：`game.sendGlobalCommand(action, cmd, args)` 发送，`game.addGlobalReceiver(action, fn)` 接收，返回值是取消注册的函数，在 `onUnmounted` 里调用。
- 提示：`showAlert(text, '', ['yes','no'])`（确认后得到 `'yes'`）、`gameAlert(text)`（浮动提示）、`showMenu(items, x, y)`（弹出菜单，坐标用 `stagePoint` 换算）。悬停提示用 `tip` 属性，类型见 `ui/tooltip.ts`。
- 文案一律 `i18n('原版键名')`；只有原版写死在代码里的少量中文可以直接写。
- 状态：`useCityStore`（当前城池、资源、建筑、将领）、`useUserStore`（君主、元宝、礼金）。

### 本地调试要点

- 开发库容器 `hot-dev-db-1`（`mysql -uroot -phot bloodwar`），对照库容器 `hot-legacy-db-1`（`mysql -uroot -plegacy bloodwar`），两边都是 `lower_case_table_names=1`。
- 测试账号：`changle` / `123456`，uid 1001，主城 cid 209355，君主将领 hid 80213。
- 原库里的账号是 `passtype='testpassport'`（差分测试用它登录），浏览器客户端登录时发的是 `uuyx`：浏览器实测前在开发库执行 `update sys_user set passtype='uuyx' where uid=1001`，测完改回 `testpassport`。
- 浏览器实测时插入的测试数据（物品、装备、技能书、元宝、黄金等）测完都要删除或还原，并和对照库的同一行比对。`difftest` 启动时虽然会把改动过的表回滚到快照，但平时开发和实测看到的都是开发库，保持它与快照一致可以避免后续测试被残留数据干扰。
- 停止开发服务后，终端里出现退出码 143 是被终止的正常结果。

### 不提交的内容

`start.exe` 等可执行文件、`legacy/`（含 `.cache`、`lang`）、`apps/client/public/assets/`、任何 SQL 与原版文案、构建产物（`dist/`）、原版数据库的账号密码。只在移植代码里出现的少量中文字符串可以提交。

## 说明

原游戏的代码与美术版权归原开发商所有。本项目仅用于个人学习与单机怀旧，不用于商业用途。
