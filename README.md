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

差分测试要求两边数据库从同一份导出开始：先 `pnpm legacy:reset && pnpm legacy:up`、`pnpm db:migrate`，再立即运行（原版的结算进程会改动数据，`difftest` 启动时会先停掉它）。首次运行会把每张表复制成 `__snap_*` 快照表，每个用例结束后按快照回滚，因此可以重复运行。新服务端由脚本以 `TICK_ENABLED=false` 在 3998 端口启动，日志在 `legacy/.cache/difftest-server.log`。回归期间，其他连接开发库的服务也必须禁用自动结算和野地刷新（`TICK_ENABLED=false WORLD_REFRESH_ENABLED=false`），避免开发服务与差分进程同时写库。

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

| 阶段                                                                                                                                         | 状态       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0 基础设施与资料提取                                                                                                                         | 完成       |
| 1 后端基础框架（命令网关、会话、用户锁、Tick、推送骨架、登录与创建角色、差分测试工具）                                                       | 完成       |
| 2 前端框架（舞台、素材加载、Fx 皮肤组件、DialogManager、登录到主界面）                                                                       | 完成       |
| 3 城池经济                                                                                                                                   | 完成       |
| 4 将领与道具（主体完成，剩余见下）                                                                                                           | 完成       |
| 5 世界与战斗（波 1–4 前后端完成并实测，占城/抓将已比对，MVP 串跑通过）                                                                       | 完成       |
| 6 社交与经济（好友/聊天/联盟/市场完成；既有差分与界面细化待做）                                                                              | **进行中** |
| 7 成长与荣誉（排行榜、领奖、统计、成就、计谋、抽奖、君主荣誉及客户端全部完成）                                                               | 完成       |
| 8 玩法活动（过关斩将/竞技场/洛阳/婚姻完成；沙场与闹钟原版不可达，未移植）                                                                    | 完成       |
| 9 独立战场（四本地 PVE 战场后端+核心客户端完成；官渡/董卓照原版关闭）                                                                        | 完成       |
| 10 GM 工具（运维 API + 单页后台完成）                                                                                                        | 完成       |
| 11 测试与发布（一键全栈 compose/备份恢复/部署文档/GM 补齐完成；全量浏览器走查通过；缺失接口补齐 8 波完成并全量回归；24h 对比与性能基准待做） | **进行中** |

### 阶段 3 已完成

城池加载与 `CityCommand` 轮询、信息面板；建筑建造 / 升级 / 拆除与队列；书院科技与研究结算；兵营造兵、遣散（二级密码）、兵种转换；城墙城防与结算；天灾人祸结算、排行重建与排行奖励；官府（税率、安抚、征收、改名、生产率、建筑总览）；城池列表与废弃城池；附属野地列表与详情、资源地转换；任务对话框与任务奖励、君主任务刷新；新手引导。

### 阶段 4 已完成

- 宝物对话框：物品列表、使用礼包与礼匣、出售。
- 物品加速（鲁班 / 墨家道具）、增益道具（神农锄、鲁班斧、战鼓、阵图、青囊书、徭役令、推恩令、典民令、安民告示等）、默认宝箱。
- 将领详情：升级、加点、洗点、改名、赏赐、解雇。
- 将领装备：穿戴、卸下、修理、修复（元宝 / 礼金）、一键修理 / 修复 / 卸下。
- 将领技能：领悟、穿戴 / 卸下技能书；宝物里的「技能书」页（筛选、回收、扩充书栏）。
- 将领详情按钮：体力 / 精力药、经验书、统率 / 攻击 / 防御宝物，俘虏招降 / 释放，投奔接纳 / 回绝，名将说明，君主改名。
- 将领历练：开始、取消、加速、结算、奇遇。
- 铁匠铺：强化、打孔、镶嵌、合成、技能书合并；打孔器、化石粉在铁匠铺内可用。
- 商城：元宝 / 礼金购买、限购、买了就用、礼券兑换；物品不足时弹出购买框。
- 特殊物品：旌旗、名帖（含君主改名）、盟主令、武器架、打孔器、化石粉。
- 客栈：招募列表与刷新、招募将领、招贤榜、结交名将、市井传闻、鉴定宝藏、五铢钱商店。
- 仓库打包资源、粮仓查看与卸下、将领「宝物」按钮（增益、倒计时、续买）。

### 阶段 4 剩余（2026-11-07 更新：原六项已按补齐波次消化）

- W3 完成坐骑相关：粮仓的激活、强化、升级；铁匠铺洗练、熔炼、装备升级三个页签。
- W4 完成迁城令、免战牌、离间符的服务端分支与客户端入口。
- W5 完成武魂与卡牌合成（成就扣物品改走 `core/achievement-rules` 钩子），并补上占城默认宝箱的开启。
- W6 完成君主「学习」面板、君主经验书与君主战术（`loadKingTactic` / `addUserLevelTimes`）、将领宝物赏赐（`largessHeroWithGid`）、赞扬与战报历练领取（`finishCommonExpr`）。
- W7 完成客栈查看名将详情、领取名将任务与传闻（`askDetail` / `getHeroPublicTask` / `getTheTask`）与游说 `persuadeHero`（含原版开服时间闸门 `mem_state 6 > 1311696000` 即关闭；单机快照闸门值为 2013-12-17，默认关闭，差分夹具置 0 后验证成功迁移并回 `reply=21`）。
- W8 完成登录奖励、签到与活动栏（沙场离线桩）；VIP 抛错桩随活动模块落地。

仍未做：

1. 活动招将：W8 已接入活动栏框架，但招将类活动原版平时无入口，未接入。
2. 委托任务的独立发布 / 接受流程：原版 `getCommissions` 为注释代码、`getCommissionDetail` 缺失，当前仅接入 type 4 已接委托（`HotelRecruitPanel` 委托入口与奖励 90% 结算）。
3. 跨服沙场连接旧外服：`joinCrossShaChang` 按原版离线语义返回 `net_error`。

W5–W8 已于 2026-11-08 完成逐行核对与差分 / 浏览器走查收尾（见下方「缺失接口补齐」与阶段 11 基线）。

代码里尚未移植的分支都会抛出 `... not ported` 错误或显示 `NotYetValid` 提示，可用 `rg "not ported|NotYetValid" apps` 查找。

### 阶段 5 已完成（收官实测：MVP 建城 → 造兵 → 出征 → 占野地 → 收战报 全流程串跑通过）

差分测试 106/106 全过：

- 波 1：世界后端与地图（地块与城查询、收藏、标记、搜索、管辖信息）、校场（伤兵、俘虏、逃兵、攻防战术、征兵、演习）、邮件（收件、发件、系统信）。
- 波 2：出征（发兵、方案、召回、踢出）、军队列表与详情、军队到达后的回城、运输、派遣。
- 波 3：战报列表与详情、战斗框、敌军来袭报警；测试工具固定随机数（`s.rng` / `s.seed` / `s.stopRng`）；侦察、掠夺、占领、攻击。
- 野地守军再生（`checkSodier`）、NPC 城建城防、占领 NPC 城。
- 兵种战术加成照原版补全；占领野地后城的产出加成同步变化。
- 波 4 服务端：野地建城（`createCityFromLand`，含驻军并入、爵位/资源校验）、政令（`governOthers` 征税/抽丁/征粮/收编/裁军）、合城（`mergeCity`，分城折算升级主城建筑、25 表拆分、名城契约）。
- 波 4 客户端：野地详情「筑城」入口与确认流程、政令面板（GovernPanel：客户端预检 + getGovernInfo 计数 + 五种政令）、合城对话框（CityMergeDialog：主/分城选择、10 级官府升级入口）；建城/政令/合城均浏览器实测通过。顺带修复出征任务 ID 映射错误与 WorldPanel 三个错键文案。
- 占城/抓将完整结算（玩家城场景差分比对）：城池易主、将领被俘入伍、占领冷却重置、占领军照原版存活回城（原版 `bak_troops` 无 `troopid` 列，`where id=troopidN` 全是不生效的死写法，忠实复刻）；结算后 `mem_battle` 保留下个 tick 才清理，同原版。
- 侦察遇巡逻兵：复用 `battleAdd` / `defcityadd` 与 `upManeuver`，双方战报、情报减半、任务目标和警报均通过差分。原版把 `getTarget` 返回的兵种 ID 当数组读取，因此有巡逻时实际为 40 回合平局且无伤亡，已按实测保留该怪癖。
- 已知原版怪癖（忠实复刻）：世界地图每个 10×10 块的 `group_concat` 受 MySQL 1024 字节上限截断，只有块内前 ~56 格能加载（两边一致，原版单机同样如此）。

剩余（未做或未比对）：

1. 占城、抓将：攻守报告全文、英雄卡片、守方军情/战果、迁城提示及双方联盟战报已比对；独立战场与跨服报告属后续阶段。
2. 名城 `check_city_type` 前置城数拒绝/通过、低官府 `delBuildings` 拆除后的建筑行已比对（随机等级仍掩码）；占领失败与城池掠夺的辎重容量、目标城扣减和军队携资源已比对；最后一城被占后的选城、迁城、秒回和军队重定向已比对。
3. 野地 8 小时刷新：按数据表猜写，原版无源码，与原版可能不同。
4. 政令的洛阳模式（`governLuoyangOthers`）与合城的 51SDK/防沉迷分支：属后续阶段。
5. 掉物品、荣誉、联盟群发与援助、洛阳出兵：均已消化——占城默认宝箱开启（W5 `default-box`）、战功荣誉（阶段 9 `getBattleHonourStat`）、联盟援助（W4 `unionAssit`）、洛阳出兵（阶段 8 `luoyangTroopStart`）、联盟群发 `sendUnionMail`（2026-11-08 收尾轮移植，`MailFunc.php:395-460`，替换原「暂未开放」桩）。
6. 数据库随机排序（`order by rand()`）需在用例里逐例固定；「释放俘虏到野地」偶尔不过。新角色地块遗留调度和占领计时导致的波动已通过固定夹具消除。

### 阶段 6 进行中（社交与经济）

- 好友系统（波 1）：`getUserRelation` / `addFriendsTaskFinish` 移植；好友/仇人对话框（好友页签添加、仇人页签删除/查看、列表渲染）。关键发现：原版 openfunc 白名单不含 `addUserRelation`/`removeRelation`——原版的关系写路径走**外部聊天服**二进制协议（单机包无该服务），故原版单机无法加好友；重制版把写路径移到主命令通道（有意决策，注释记录），并修掉原版 insert 引用的不存在 `tname` 列与 removeRelation 无 uid 过滤两个缺陷。
- 聊天（波 2）：push 网关承载世界/联盟/私聊频道，`sys_user_state.forbiend` 禁言；完整 ChatPanel 提供综合/世界/联盟/私聊/战况五个视图、展开收起、私聊对象与斜杠命令、未读提醒、频道开关、玩家屏蔽和写信/好友入口。proc 52 战况、proc 17 联盟事件已接入；全局屏蔽词自动过滤，管理员可增删并实时同步，普通玩家只读。双账号实测世界、私聊、联盟、未读、屏蔽/解除和关键词增删通过。
- 好友添加/删除实测闭环：输入君主名 → 确定 → 落库 → 列表刷新。
- 联盟核心（波 3a/3b）：创建、申请/取消、邀请/接受/拒绝、成员列表与分页事件、职务调整、踢人预约/撤销、退盟与最后成员解散、盟主转让（信物/缓冲随位迁移）均已完成。简介公告、外盟详情、军情、友好申请/应答/解除、中立与宣战、联盟私有化也已移植。
- 联盟 3c 与完整客户端：联盟主城初始化、捐献与建筑升级、职位提升、商城兑换、排名奖励、四色势力范围和自盟地图数据均已完成；概览、成员、申请邀请、外交、军情、主城商城、势力七个页签已开放。proc 17 联盟事件实时推送已接入。浏览器实测建盟、成员生命周期、简介、捐献兑换、军情、外交、邀请接受、退盟和势力查询通过。
- 市场波 4（自动运输前后端）：`addAutoTrans` / `removeAutoTrans` / `getAutoTrans` / `hasAutoTrans`——目的地须为己方城、数量上限=出发城市场等级×100000、商队契约（buftype 17 / 物品 120）三日有效、距离×网格耗时、任务 314、同时 10 条上限。`HandleAutoTrans` / `HandleTrade` 已移植提前出货、单次删除、每日顺延、到货收货、任务 25/26 与双方战报；市场建筑入口、在途列表、运输计划新增/删除与契约确认已接入。4 组自动运输差分通过；浏览器实测新增/删除、单次到货、每日顺延、资源不足与交易报告均通过。
- 市场波 5（交易行与商人）：`buyFromMerchant` / `sellToMerchant` 支持元宝、礼金和批量交易；`sellToUser` / `buyFromUser` / `getUserBuyList` / `getUserSellData` / `cancelSell` / `cancelAutoTrans` / `accelerateSell` 全部移植，覆盖挂单扣货、官价浮动、联盟限制、筛选分页、撤单返还、木牛流马加速、在途到货与双方战报。商人、玩家交易和自动运输共用原版距离常量与 `HandleTrade` 结算。完整市场客户端已开放；双账号浏览器实测商人买卖、撤单、加速和购买到貨均通过。
- 校场演习补测（2026-10-27）：双方阵容创建、`HandleBattle` 结算、属性与伤亡落库、结果读取后删除全链路通过差分；正式迁移补齐 `mem_maneuver.attackadd/resistadd/wallhp`。客户端开放双方兵力输入、20 万上限、5 次轮询和结果展示，浏览器实测显示 40 回合平局。
- 鸿胪寺界面细化：`buildingInfo` 补齐联盟驻军与三项权限；客户端显示驻军容量、将领/君主/出发地、到达与停留时间，支持进入联盟、查看军队详情及允许驻军/反掠城/反占领切换。浏览器实测通过。
- 宫廷将领面板：将领属性、增益与状态列表，城守/主将/军师任命，流亡将领召回及休养列表已接入建筑入口；任命、忙碌替换校验和召回扣费通过差分，浏览器实测召回旧部与无伤员休养弹窗通过。

本轮完整回归：686 项单元测试、131/131 组差分测试通过；格式检查、Lint、类型检查和构建通过。

#### 阶段 6 未完成（2026-11-08 更新）

1. **既有差分补强**：全量差分 198/198 组通过（2026-11-08 分段回归）；联盟群发已补齐，长尾随机分支按用例暴露再补。
2. **后续界面细化**：本轮已落地 P0–P3——聊天物品链接（`game/chatLink.ts`，发送 `CTextInput.textWithItemTip` / 接收 `ArmorShow.filterTip` 协议两端对照原版，3 件上限与物品提示齐备）、装备「展示」入聊天、武魂卡牌与问答宝箱等面板；P4 经原版入口核对为白名单外死入口，不做。剩余为其他未迁移面板与交互细节。

#### 已知差异与实现说明

- `union`、`force` 是 MySQL 8 保留字，相关 UPDATE 需反引号（原版无引号在 MySQL 5.1 下不报错）。
- `EVT_ADD_UNION` 为 0、`EVT_CHANGE_LEADER` 为 3、`EVT_CHANGE_NAME` 为 4、`EVT_RELATION_FRIEND` 为 5；事件文案全部走 lang 模板。
- 好友关系的写路径走主命令通道（原版走外部聊天服，单机包无该服务）；聊天协议 JSON 化但 proc 号照原版。
- 原版 `bak_troops` 无 `troopid` 列，结算里 `where id=troopidN` 全是死写法；`mem_battle` 结算后保留下个 tick 清理——均已忠实复刻。
- 世界地图每块 `group_concat` 受 1024 字节截断（块内前 ~56 格可加载），原版同样如此。

### 阶段 7 完成（成长与荣誉）

- 排行榜基础查询：`getPageRank` / `getRankRank` / `getNameRank` / `getMyRank` 按原版白名单表、10 条分页、名称搜索与空榜语义实现；玩家与军事榜触发任务 315–318。两组分页与搜索差分通过。
- 排行榜主界面：底部“排行”入口开放君主将、玩家、联盟、将领、军事、财富、战场分类，支持排序切换、翻页、排名跳转、名称高亮、我的排名与本盟排名。浏览器实测完整浏览操作与无联盟提示通过。
- 活动排行与领奖：`getRankConfig` / `getRankReward` 覆盖总榜、昨日榜与君主将，包含动态列名、活动说明、领奖资格、时限、重复领取和奖励弹窗。公共发奖规则由商城与排行共用；三组奖励差分通过，浏览器实测物品与礼金实际到账。
- 幕僚统计（StatFunc.php）：`getStats` 五个只读页签——城池（升级/造兵/城防队列计数）、资源（向下取整的库存）、产量（含书院税率科技 tid 25 与将领俸禄扣减）、将领（计算属性 + 状态名）、军队（按兵种拼音键，超过 10 万显示「万」）、城防（防御数量与剩余城墙面积）；每行坐标渲染为 `(x,y)`。军队/城防页签保留原版的 `group_concat` 原始列以便逐字比对。单测 7 个，五页签差分通过。
- 幕僚统计客户端：StatDialog 六页签与底部「统计」入口接入。
- 成就（AchivementFunc.php）：成就点数总览、分组分页（open_time 三种解锁组合的怪癖）、详情的库内 SQL 模板逐字执行（cfg_achivement.sql_current_value / cfg_achivement_goal.sql_check_goal，`rank` 保留字已反引号）；写路径此前已随任务系统移植。客户端成就面板接入。
- 计谋（TrickFunc.php + BufferFunc::getTrickBuffer）：`useTrick` 分派 cfg_trick 全部 24 行（前置校验/冷却/精力/锦囊/城守智谋 roll/24 个效果/任务 88），`getTrickList` / `getTrickBuffer`。共享抽取：TaskRules.completeTaskGoalBySortandType、TroopCommands.recallTroop、HeroExprCommands.cancelExpr。怪癖：原版 `mt_srand(time())` 重播种使中计随机不可差分固定（已实测 uopz 覆盖 mt_rand 本体，序列每次请求重置）；挑拨离间 `order by rand()` 保留字面。客户端 TrickDialog 五件套接入，锦囊不足复用购买框链路。
- 抽奖（LotteryFunc.php）：白名单 8 命令（爵位/开关/时段三闸门、免费+续抽链、randWin 保底表、发奖与公告、任务 293）。实测更正：`useMoney` 在原版必然扣 6 元宝（`array()>1` 恒真）、`getWin` 原版直接 PHP fatal（已原样复现）。原版单机抽奖整体关闭（mem_state 150=1，两库一致），成功路径无原版对照。客户端抽奖轮盘接入。
- 君主荣誉：`loadUserDetail` / `loadUserDetailInfo`（auto-vivify 语义保留）、`changeUserDesignation` 称号、`medalChange` / `getMedalRecord` 勋章、`praiseHero`（新旧两套称赞分支 + enhanceHero 助手）。客户端君主信息与称号对话框接入。

本轮完整回归：服务端 420 项、客户端 333 项、tools 60 项单元测试全过，差分 149/149 组通过；格式检查、Lint、类型检查和构建通过。已知波动：rank_hero 并列排名（904-906 名）在 MySQL 5.7 与 8.4 间的行序 rotates，差分偶发 1 组失败（两边引擎均逐行忠实于 ReportCron.php:412）。

### 阶段 8 完成（玩法活动）

工作流并行移植（调研→按家族并行→客户端→集成差分→回归门）：

- 过关斩将（PKFunc.php 征战半部）：7 命令 + 内联 3v3 回合 PK 引擎——暴击/破击/闪避/格挡四触发按原顺序消耗 mt_rand(1,20000)（分支忽略也照掷）、speed 先手、幸存者 energy 重入队、掉落 mt_rand(1,10)==3、章节宝箱 + 首通 cfg_pk_first 前三、军令 19200 经济。
- 竞技场（PKFunc.php 后半）：12 命令 + 可注入 `pk-engine.ts`；排名双写与逐行搬移、NPC 占领（isopen 清零 + 双色公告）、超次 (count-9)×5 扣费、首榜 50 元宝、连胜 3/5/10/15/30 公告（败场 times=0 重置连胜按原样）、防守奖励 5 小时线性衰减、排名奖励走共享 RewardRules。
- 洛阳战场（LuoyangFunc.php）：8 命令——周三 19 点闸门（DB 时钟）、军旗与 +25% 上限 ceil、遭遇战 type=5 走通用 OLdBattleCron、useLuoyangTrick（阶段 7 欠账收回，只开放 type=13）、援军权；怪癖照抄（车轮技术恒真分支、召回两分支同 SQL 的死写法合并、getTroopTime 把 uid 当 hid 传入）。
- 洛阳归属：12 命令——分配（log_luoyang_belong 连续计数 + 王爵位 buffer 130527 + nobility=21）、诏安（全盟 10333 buffer 72h 顺延）、洛阳政令（governLuoyangOthers 五政令，成功文案按原版 RETURN 而非抛出）、备战洛阳补种 112001-112004； PearDB 错误路径语义保留（mem_luoyang_info 表缺失走 catch→原版错误文案）。
- 婚姻（MarrySystemFunc.php）：22 命令——君主历练收口（begin/faster/cancel，tick 侧此前已移植）、提亲四档成功率 + 守护 NPC 战（复用 PkEngine）、红颜好感梯（12066-12069）、怀孕/胎教/接生（2 胎上限）/培养出师（herotype 10001 子将）/改名/周游列国；怪癖：getMadamChild 性别与名字表反着取、proposeMarry 无 PK 成功分支同样发公告、铜钱支付受 gid 152→888888 写入怪癖影响。
- 集成：5 模块注册进 app.module.ts；8 组差分用例（722 行）覆盖过关斩将两条、竞技场两条、洛阳战场、洛阳归属、婚姻两条（含提亲成功率 rng 固定与守护 NPC 落败分支）。
- 网关层补齐：lang.service 缺失 lang 键按 PHP 未定义索引语义回空串；网关裸 SQL 错误按 lib/database.php PearDB die 路径回 `[0, "PearDB returned an error. "]`（不再泄漏 MySQL 8 原始报错）。
- 范围外（调研甄别）：沙场全文件原版不可达（除 2 个类方法外全部 return null，cfg_sc_goods 表不存在、mem_state 28=0）；ShaChangFunc 为跨服 HTTP 桩（CROSS_* 指向已死官方服），与 BattleNet* 同属范围外；闹钟 9 函数不在 openfunc 白名单（调用必吃 command_exception），触发列由闭源 C++ 结算进程写入、两库恒 0——均未移植，如需逐字对齐可后补 9 个抛错桩。

本轮完整回归：服务端 566 项、客户端 386 项、tools 60 项单元测试全过，差分 157/157 组通过；格式检查、Lint、类型检查和构建通过。

未覆盖：洛阳派兵的周三 19 点成功路径差分依赖 DB 时钟不可夹具（已测拒绝分支与全部其他闸门）；提亲守护 NPC 战的胜仗分支不可达（PK 引擎已由竞技场/过关斩将用例逐刀比对）。五家族新面板的浏览器实测已于阶段 11 走查完成（见 [走查记录](docs/阶段11-浏览器走查记录.md)，15 项全过）。

### 阶段 9 完成（独立战场，方案 A 变体）

工作流并行移植（六切片 + 战场客户端 + 集成差分）：

- S1 战场大厅（battlefield/）：15 条 openfunc 命令——getBattleInfo 四类型 + 倍率活动、getBattleNetUrl 单机关闭恒回空、PVPBattleInfo 四阵营、勋章行情、清战重置；44 单测。
- S2 生命周期（battle/）：createBattle/joinToBattle/joinToPVPBattle/getBattleInvite + battlefield-helpers/-utils 共享助手；关键差分固定点：原版 `rand()%(10-total)` 数学事实使收缩分支恒死，逐次 draw 对齐；39 单测。
- S2b 退盟/邀请（battle/）：quitBattle 完整 337 行（倍率、援军折算荣誉、黄巾刷子检测、勋章、防沉迷、关场）+ 邀请四命令 + act-battle 助手；31 单测。
- S3 战场 Tick（正式动刀点落地）：troop.tick.ts task 7/8 到达分支 + state-1 返回特例替换原「搁置」；battle-result.ts type-4 终局全量（mem_war_event 战况、事件触发器、winpoint、伤兵过滤）；新增 battle-field-uid.ts（resetBattleFieldUid 四态）与 battle-event.ts（cfg_battle_event 双位触发器）；41 单测。忠实复刻三处原版 bug：winpoint LEAST/GREATEST 死代码块（`$unionid==3?4:3` loose 陷阱）、cfg_js.php:550 坏列插入按可观察效果跳过、check1001 返回 2 恒真放行。
- S4 行军与交战（battlefield/）：startBattleTroop/battleTroopDispatch/battleAttack/battlePatrol 等 11 命令 + canGoto 邻接四态；22 单测。
- S4b 援军/召军/加速/探索（battle/）：11 命令 + 共享助手导出（firstGetUserBattleInfo/ifFrozeExit/enoughIntervalFromLastMark/resetBattleFieldUid/enhanceArmy 等）；34 单测。
- S5 战场周边（battle/）：任务面板（ALARM_TIDS 60901-60919）、将领对话、功勋统计、成员列表、战场商城（buyBattleGoods 12 条购买路径 + updateBattleOpenState 开战场链）；37 单测。
- S6 推送消费（push/）：mem_war_event 排空→proc 52 广播（WarEventService.drain，参战者定位 + 送达即删 + 离线保留重试）；proc 53 有意不接线（本地无生产者）。
- 战场客户端核心流（22 文件 + 27 单测）：BattlePanel 战场大地图（等距据点/军旗/军粮条/30s 轮询/退出结算）、Create/Join/SelectUnion/BattleFiledViewDialog（派遣/侦察/攻击/交谈/详情/探索/征召）、兵力调度五对话框、军队详情两卡、BattleChatDialog、退出结算。未做：AttackTacticsDialog（白名单外死命令）、战况页签、组队邀请三件、商店/勋章三件、周边排行/趋势图（列在客户端 unresolved）。
- 集成：6 模块注册、11 组差分用例、2 轮修复——battlePatrol 渲染参数丢失（lang.t 已是 sprintf，去掉外层无参 sprintf）、createBattle 去事务对齐原版半成品语义、新增 @RejectedCommand 装饰器（白名单外命令抛 `funcName+你异常了!!!`，同时修正好友/联盟同类偏差）、deps.cell 空值 false 语义、AMF 信封索引修正；单测修正三处与原版 PHP 不符的断言（getUserBattleInfo 空赤壁态回 [0,0]、joinToPVPBattle 闭盟 `count(1)<null` 实测 1064 → PearDB 文案、battlePatrol 断言的就是 bug）。

### 阶段 10 完成（GM 工具）

- 服务端 `apps/server/src/gm/`：独立的 `/api/gm/*` 接口，请求头 `x-gm-token` 校验，未配置 `GM_TOKEN` 时一律拒绝（403）；不走游戏命令网关。
- 后台 `apps/gm`：单页六个分区（玩家、城池、将领、宝物、公告、状态），`pnpm dev:gm` 启动，`VITE_GM_TOKEN`、`VITE_ASSET_URL` 见 `apps/gm/.env.example`。
- 玩家：按账号 / 君主名搜索，改元宝、礼金、声望、爵位、官职（带日志），封禁与解封，测试玩家数据清理。
- 城池：按城名或坐标搜索，建筑与科技一键满级。
- 将领：玩家将领与名将列表，改等级、经验、四维后重算属性，放入城池。
- 宝物：物品与装备模糊搜索、图片预览、发放、删除。
- 公告与世界：滚动公告、GM 喊话（推送 proc 14）、登录公告、任务 / 活动开关（`mem_state`）、史诗任务进度、手动刷新野地、在线人数与主表行数概览。
- GM 属于运维功能，参照修改器实现，不做差分测试；单元测试 41 项。

### 阶段 11 进行中（测试与发布）

- 发布准备完成：docker/prod 一键全栈 compose（db/server/nginx web 三服务，/ws 同源代理，客户端与 GM 静态同源托管；端到端实测六项冒烟全过）；scripts/backup-db.sh（mysqldump + 裁剪）与 restore-db.sh（MyISAM→InnoDB 在线转换，沙箱实测）；docs/deploy.md 部署文档；package.json 增 prod:up/prod:down/db:backup/db:restore。
- GM 补齐（走查前置能力）：登录公告（announce/login 查看与设置）、任务/活动开关（mem_state 读写）、史诗任务进度（sys_user_goal 查询/设置）——13 项新单测，总 41/41。
- 全量浏览器走查通过（2026-11-05，[走查记录](docs/阶段11-浏览器走查记录.md)）：阶段 7/8/9 累积 15 项面板/链路全部验证——排行榜/统计/成就/计谋/君主信息、抽奖关闭态与 GM 开关后轮盘、过关斩将、洛阳归属、婚姻、竞技场（爵位门槛两侧）、战场大厅→新建战场→黄巾之乱大地图（含道具校验与创建成功链）、GM 后台六分区、登录公告登录页可见；发现并修复战场描述富文本渲染（FxLabel→FxText :html），竞技场 face=0 破图为原版同现数据工件不改；差分遗留战场数据触发 sys_battle_city 主键冲突按原版 PearDB 文案报错（错误路径实测确认），已清理；走查数据全部还原。
- 2026-11-08 回归基线与基准：全量差分 198/198 组全绿（0 失败 0 崩溃；整段运行会把 7.75GB Docker VM 上的 legacy mysqld 推到 OOM，按 86 段 + 补跑 2 段分段执行、段间重启 legacy 容器，见 [走查记录](docs/阶段11-浏览器走查记录.md) 补录）；单元测试 server 941/941、client 497/497、tools 66/66、shared 1/1 与三端 typecheck 0 错均为本日复跑核实；lint 与 format:check 复跑当前不过（`tools/src/difftest/cases.ts` 格式、`BattlePanel.vue` 未用变量、`ChatPanel.vue` v-if/v-for 顺序），与收尾报告「lint/format 过」存在出入，按复跑结果如实记录。构建基准：客户端主包 1190.71 kB / gzip 322.46 kB（构建 2.33s、1448 modules，vite 警告主 chunk 超 500 kB），GM 后台 86.03 kB / gzip 31.79 kB；镜像 hot-prod-web 256MB、hot-prod-server 658MB、mysql:8.4 1.11GB（基础镜像，与 legacy/dev 栈共用；镜像体积经 `docker images` 复核一致）。启动耗时本轮无实测数据。
- 未做（长时/人工项）：差分 24 小时结算对比、性能与兼容性基准（含启动耗时）、可选桌面壳。

### 缺失接口补齐（进行中）

[续接记录（2026-11-07）](docs/缺失接口补齐-续接记录.md)

客户端引用但服务端未实现的接口按 8 波补齐，每波：读原版 → 服务端与单测 → 差分用例 → 客户端 → 全量检查 → 浏览器实测并还原数据 → 提交。

- W1 完成：采集 `gatherFieldStart` / `gatherFieldEnd` / `gatherStartAll` / `gatherEndAll`（`world/gather.commands.ts`，含藏宝图、寻宝与采集活动礼包、古朴木匣、名将任务道具；原版 `gatherEndAll` 无排序、按 MyISAM 插入顺序结算，这里按部队 id 排序）、`allowAutoDiscard`、宝物合成 `goodsCompose`。客户端：军队对话框四个采集回包的提示、收获确认带采集时长、全部采集不再二次确认；合成结果框修复（原先把物品列表多包了一层，结果框为空）。差分 2 组新用例（采集时长的秒数会跨秒，比较时抹掉）。
- W2 完成：装备仓库 `loadUserArmor` / `loadUserActivedArmor` / `sellArmor`（含回收装备活动礼包）/ `zhuangbeichaijie` / `multipAnalyzeArmor` / `loadActiveArmorSpecialGoods` / `activeArmorSpecial`（末日之刃四种特效重随），在 `hero/armor.commands.ts`。注意：原版 `0704` 作为 PHP 参数是八进制（log_goods 记 452），写在 SQL 字符串里是十进制（log_armor 记 704）；`loadUserActivedArmor` 传 0/1/2 以外的类型时原版 foreach 警告变成错误回包，这里照抄。客户端新增 `views/armor/`（ArmorDialog / UserArmorItem / ActiveArmorSpecial），信息面板「装备」按钮打开；部位、品质过滤，分页，回收、分解、特效、激活、拆解菜单，批量选择分解，全部修理 / 全部修复，武器架加栏位，蓝装以上走二级密码。「展示」依赖聊天物品链接，已于 2026-11-08 落地（`game/chatLink.ts`，发送/接收协议对照原版 `CTextInput.as:128-164` / `ArmorShow.as:22-54`，上限 3 件），菜单解除置灰。差分 1 组新用例。
- W3 完成：铁匠铺洗练 `loadXilianGoods` / `doXilian`、熔炼 `loadFusionableArmor` / `loadPartArmor` / `reloadArmor` / `combineArmor`、装备升级 `doUpgradeArmor`、未激活列表 `loadUnActivePartArmor` / `loadUnActiveHorseArmor`；`doStrong` / `doEmbed` / `initHoles` 补上坐骑分支（灵通甘草、驯马技巧上限、马装孔位与专属限制）。修了 `doStrong` 失败时回包的极品属性（原版失败回 null）。客户端：铁匠铺补齐洗练、熔炼、装备升级三个页签，镶嵌页可打开装备激活列表（原版这个对话框没有入口）；马厩补齐驯服、强化、马装选择和升级，升级页与铁匠铺共用。铁匠铺和马厩对话框高度按原版改为 492，命令面板不再被裁掉，铁匠铺去掉了原版没有的「进入」按钮。差分 1 组新用例。
- W4 实现：普通/高级迁城、免战与续期、元宝免战、休假与提前解除、离间符、宣战/讨逆圣旨、联盟援助及对战确认；宝物、君主状态和世界地图已接入对应界面，登录休假账号显示解除/退出面板。保留原版离间符全局扣忠诚、休假冷却编号等兼容行为。新增 8 组差分用例覆盖成功写库及校验顺序。
- W5 完成：武魂创建/选择/使用/升级（`goods/wuhun-card.commands.ts`，成就扣物品改走 `core/achievement-rules` 钩子）、卡牌合成 `CardMixPanel`（严格阈值、失败不耗材料；原版合成闸门 `mem_state 197` 照抄保持关闭，行为一致但未解锁为可玩功能）、问答宝箱与领奖、占城默认宝箱开启。差分 9 组新用例，目标差分 9/9（2026-11-07）。
- W6 完成：将领宝物赏赐 `loadHeroGoods` / `largessHeroWithGid`（虎符在 `hero-item` 与 `honor` 两入口对齐，低阶换高阶放行、逆向拒绝）、赞扬 `praiseHero` 君主分支、君主学习 `loadKingTactic` / `addUserLevelTimes`（保底、失败计数、小数次数向上取整）、战报历练领取 `finishCommonExpr` 与报告正文 `getReportContent`（归属校验、已读清理）。差分 5 组新用例。
- W7 完成：客栈名将详情 / 名将任务 / 游说（`askDetail` / `getHeroPublicTask` / `getTheTask` / `persuadeHero`，游说保留原版开服时间闸门）、专属任务领奖 `tid`/`group` 修正、空装备的 PHP 比较兼容、委托（type 4 已接委托）入口与奖励 90% 结算、备战洛阳 `reduceGoal` 203。差分 2 组新用例。
- W8 完成：登录奖励/签到/活动栏/craftbuffer/黄巾董卓进度/将领列表（`activity/login-activity.commands.ts`；`getLoginReward` 原单机即返回 null，照抄）、跨服沙场 `joinCrossShaChang` 离线 `net_error` 桩、VIP `sendCloseMsg` 桩；公告默认打开（手动打开完成任务 292、关闭不完成），签到日期校验加固。差分 1 组新用例。
- 额外入口：官府详情采集/收获入口（`game/field.ts` 14 项逻辑测试）、君主状态更改入口（W4 补漏保留）；`tools/src/coverage.ts` 接口注册扫描 492/507，余 15 项为原客户端 0 引用候选，留待核实产品入口。
- 2026-11-08 收尾轮（工作流波次；W5–W8 实现零业务改动，源码改动仅差分夹具 / 用例与联盟群发）：
  - `W5-wrap`：W5 暂存 diff 逐行对照原版 PHP 审阅通过（`useWuHun` / `genWuHunBySuipian` / `genWuHunByRumor` / `getWuhunByHid`、`useQuestion` 先抽题后扣传音符等），仓库源码零改动。
  - `W6-wrap`：修复 largess 差分夹具漏播物品 160042（`tools/src/difftest/cases.ts` W6 largess 用例，`w4Goods` 置库存 1），服务端切片逐条核对无业务改动。
  - `W7-wrap`：逐行对照 `HotelFunc.php` / `TaskFunc.php` 核对一致（`tryLionizeHero` 按客栈等级 ×500 金、`LionizeHero` 槽位 / 求贤诏 / 爵位闸门、`onCancelFriend` state 2/3 拒绝等）。
  - `W8-wrap`：切片产物已在前序落盘，零文件改动，逐项对照 legacy PHP 核验一致（`finishOpenAnnounce` 完成任务 292、`getLoginReward` 原版顶部 `return` 死代码照抄等）。
  - `union-mail`：移植 `sendUnionMail` 剩余段（`MailFunc.php:395-460`），替换原「联盟群发信暂未开放」桩——卫兵链与传音符卫兵照原版；新增差分用例（套件第 200 例）。
  - `entry-audit`：coverage 余量 15 项逐项定性维持不做（对反编译客户端逐名 grep 引用 0 命中核实）；coverage 492/507。
  - `final-regression`：全量回归收尾（数字见阶段 11 基线）；未做任何 git 提交，提交由主会话接管。
  - 集成核验：`LoginActivityModule`（`app.module.ts:96`）、`WuhunCardCommands`（`goods.module.ts`）、`AchievementRules`（`core.module.ts`）、`HeroItemCommands` / `KingCommands` / `HeroExprRewardCommands`（`hero.module.ts`）注册均在位，零改动。
- W5–W8 浏览器走查（2026-11-08，每轮经脚本 checksum 基线恢复校验：W6/W7/W8 `checksumDifferences=[]`，passtype 测后还原 `testpassport`）：W6 3/3（赞扬、君主学习、战报历练）与 W8 5/5（公告与签到、黄巾 / 董卓进度、活动栏挂载）全过；W7 初轮 4/8，4 例失败定性为脚本侧问题（组 id 990070 落入委托区间路由、FxDataGrid 选中行无 `selectable` 类）后重写为「浏览→详情→领取」真实命令流，**8/8 全过**（2026-11-08 补充，见[走查记录](docs/阶段11-浏览器走查记录.md)）；W5 沿用既有干净证据（目标差分 9/9）。战场商城按原版结构补齐（分组页签 + armor/hero tooltip 查表，battleShop 单测 14/14）。
- 待做：官府采集 / 收获与君主状态等额外入口的浏览器验收（续接记录 P5）；差分套件现有 200 例而分段回归为 198 组，差额 2 例（含联盟群发新例）未能逐一对账，已由 2026-11-08 分段复核 6 段 200/200 覆盖；商城限时上架倒计时、mBattleShopType==2 跨服积分面板、addForceBtn（本地服不下发对应战场，如实记录）；24h 差分对比与帧率采样（长时项）；桌面壳（未确认）。

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

- 每次运行开始时两边都回滚到快照，每个用例结束后也会把它改动过的表回滚，所以用例之间互不影响；用例需要的数据在用例里自己插入（用 9000xx 一类不冲突的 id）。大表按主键每 10000 行分块做 CRC32 校验，只有变化块执行逐行差异比较或按快照恢复，避免全表连接。
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
