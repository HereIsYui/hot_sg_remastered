import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { RewardRules, type RewardLogReasons } from '../core/reward-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';
import { PkEngine, type PkHeroEntry } from './pk-engine';

type Row = Record<string, unknown>;

/**
 * PKFunc.php:663-1407 — the (single-server) arena ranking. The cross-server part
 * (CrossAssembleSend / CrossArenaDialog) belongs to another family and is not ported here.
 * All 12 whitelisted commands (lang.php:2656) plus the internal helpers. The rank shuffles
 * double-write mem_assemble + sys_user_assemble and move rows one by one (updatePartUserRank),
 * exactly like the original.
 */
@Injectable()
export class ArenaCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly random: RandomService,
    private readonly goods: GoodsRules,
    private readonly cities: CityRules,
    private readonly users: UserRules,
    private readonly rewards: TaskRewards,
    private readonly grant: RewardRules,
    private readonly pk: PkEngine,
  ) {}

  /** PKFunc.php:705 loadArenaBattleInitData. */
  @GlobalCommand()
  async loadArenaBattleInitData(ctx: CommandContext): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const nobility = await this.cell(
        sql<Row>`select nobility as v from sys_user where uid = ${ctx.uid}`,
      );
      // 爵位没达到上造的不上竞技场
      if ((await this.users.bufferNobility(ctx.uid, nobility)) < 2) {
        throw GameError.lang('assemble.nobility_not_enough');
      }
      // 初始化数据开始
      const userAssembleInfo = await this.row(
        sql<Row>`select * from mem_assemble where uid = ${ctx.uid}`,
      );
      const userArenaInfo = await this.row(
        sql<Row>`select * from sys_user_assemble where uid = ${ctx.uid}`,
      );
      if (phpEmpty(userAssembleInfo)) await this.initUserAssembleInfo(ctx.uid);
      if (phpEmpty(userArenaInfo)) {
        const userRank = await this.cell(
          sql<Row>`select \`rank\` as v from mem_assemble where uid = ${ctx.uid}`,
        );
        await sql`insert into sys_user_assemble (uid, \`rank\`, maxrank)
          values (${ctx.uid}, ${userRank}, ${userRank})`.execute(this.scope.db);
      }
      const userArenaHeroInfo = await this.row(
        sql<Row>`select * from mem_assemble_hero where uid = ${ctx.uid}`,
      );
      if (phpEmpty(userArenaHeroInfo)) {
        const kingHid = await this.cell(
          sql<Row>`select hid as v from sys_city_hero where uid = ${ctx.uid} and herotype = '1000'`,
        );
        if (!phpEmpty(kingHid)) {
          await sql`insert into mem_assemble_hero (uid, hid1, hid2, hid3)
            values (${ctx.uid}, ${kingHid}, ${kingHid}, ${kingHid})`.execute(this.scope.db);
        }
      }
      // 每日挑战次数清零
      await this.resetDailyCount(ctx.uid);
      // 初始化数据结束
      const userArenaInfoNow = await this.row(
        sql<Row>`select *, greatest(0, next_challenge_time - unix_timestamp()) as leavingtime
          from sys_user_assemble where uid = ${ctx.uid}`,
      );
      return [
        userArenaInfoNow,
        await this.loadUserAssembleRecord(ctx.uid),
        await this.loadWinRecord(),
        await this.loadArenaUserData(ctx.uid, 0),
        await this.loadUserBattleHeroRows(ctx.uid),
      ];
    });
  }

  /** PKFunc.php:663 holdBattleHeroInfo. */
  @GlobalCommand()
  async holdBattleHeroInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const heroCount = phpIntval(param.length);
      if (heroCount !== 3) throw GameError.lang('assemble.hero_count_error');
      const hid1 = phpIntval(param.shift());
      const hid2 = phpIntval(param.shift());
      const hid3 = phpIntval(param.shift());
      const userKingHid = await this.cell(
        sql<Row>`select hid as v from sys_city_hero where uid = ${ctx.uid} and herotype = '1000'`,
      );
      if (phpEmpty(userKingHid)) throw GameError.lang('useGoods.king_cannot_find');
      const userHidArr = [hid1, hid2, hid3];
      if (!userHidArr.includes(phpIntval(userKingHid))) {
        throw GameError.lang('assemble.king_not_in');
      }
      const attackHeroInfo = await this.rows(
        sql<Row>`select * from sys_city_hero where uid = ${ctx.uid} and hid in (${hid1}, ${hid2}, ${hid3})`,
      );
      if (attackHeroInfo.length === 1 || attackHeroInfo.length === 2) {
        const userHeroHidArr = await this.rows(
          sql<Row>`select hid from sys_city_hero where uid = ${ctx.uid}`,
        );
        if (userHeroHidArr.length >= 3) throw GameError.lang('assemble.need_change_hero');
      }
      await sql`insert into mem_assemble_hero (uid, hid1, hid2, hid3)
        values (${ctx.uid}, ${hid1}, ${hid2}, ${hid3})
        on duplicate key update hid1 = ${hid1}, hid2 = ${hid2}, hid3 = ${hid3}`.execute(
        this.scope.db,
      );
      return [this.lang.t('assemble.update_succ')];
    });
  }

  /** PKFunc.php:689 loadUserBattleHero. */
  @GlobalCommand()
  async loadUserBattleHero(ctx: CommandContext): Promise<unknown[]> {
    return this.loadUserBattleHeroRows(ctx.uid);
  }

  /** PKFunc.php:840 loadRankBefore10 — the 首榜挑战 list (index 1). */
  @GlobalCommand()
  async loadRankBefore10(ctx: CommandContext): Promise<unknown[]> {
    const ret: unknown[] = [];
    if (await this.check(sql<Row>`select 1 as ok from mem_assemble where uid = ${ctx.uid}`)) {
      ret.push(await this.loadArenaUserData(ctx.uid, 1));
    }
    return ret;
  }

  /** PKFunc.php:848 loadBeforeUser10 — the 竞技挑战 list (index 0). */
  @GlobalCommand()
  async loadBeforeUser10(ctx: CommandContext): Promise<unknown[]> {
    const ret: unknown[] = [];
    if (await this.check(sql<Row>`select 1 as ok from mem_assemble where uid = ${ctx.uid}`)) {
      ret.push(await this.loadArenaUserData(ctx.uid, 0));
    }
    return ret;
  }

  /** PKFunc.php:856 startArenaChallenge. */
  @GlobalCommand()
  async startArenaChallenge(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const targetUid = phpIntval(param.shift());
      const isSkip = phpIntval(param.shift());
      if (
        await this.check(
          sql<Row>`select 1 as ok from sys_user_assemble where uid = ${ctx.uid}
            and next_challenge_time > unix_timestamp()`,
        )
      ) {
        throw GameError.lang('assemble.time_is_cooling');
      }
      const userRankCell = await this.cell(
        sql<Row>`select \`rank\` as v from mem_assemble where uid = ${ctx.uid}`,
      );
      if (phpEmpty(userRankCell)) throw GameError.lang('assemble.user_not_exist');
      const targetUserRankInfo = await this.row(
        sql<Row>`select * from mem_assemble where uid = ${targetUid}`,
      );
      if (phpEmpty(targetUserRankInfo)) throw GameError.lang('assemble.target_not_exist');
      const nobility = await this.cell(
        sql<Row>`select nobility as v from sys_user where uid = ${ctx.uid}`,
      );
      if ((await this.users.bufferNobility(ctx.uid, nobility)) < 2) {
        throw GameError.lang('assemble.nobility_not_enough');
      }
      if (ctx.uid === targetUid) throw GameError.lang('assemble.target_is_wrong');
      // 检测被攻击玩家是否符合攻击条件
      const targetRank = phpIntval(targetUserRankInfo!['rank']);
      if (targetRank > 10) {
        const userBeforeMax = phpNum(userRankCell) - 9;
        if (
          phpNum(targetUserRankInfo!['rank']) >= phpNum(userRankCell) ||
          phpNum(targetUserRankInfo!['rank']) < userBeforeMax
        ) {
          throw GameError.lang('assemble.target_not_exist');
        }
      }
      // 检测攻防两方的将领信息
      const attackHeroConfig = await this.row(
        sql<Row>`select * from mem_assemble_hero where uid = ${ctx.uid}`,
      );
      const resistHeroConfig = await this.row(
        sql<Row>`select * from mem_assemble_hero where uid = ${targetUid}`,
      );
      if (phpEmpty(attackHeroConfig) || phpEmpty(resistHeroConfig)) {
        throw GameError.lang('assemble.hero_data_error');
      }
      await this.checkHero(ctx.uid, attackHeroConfig!, targetUid, resistHeroConfig!);
      // 将领可能被系统更新了将领配置，需要重新取下 (checkHero repairs both configs; the rows are
      // NOT NULL so the re-read always answers — the fallback only satisfies the types)
      const attackConfigNow =
        (await this.row(sql<Row>`select * from mem_assemble_hero where uid = ${ctx.uid}`)) ??
        attackHeroConfig!;
      const resistConfigNow =
        (await this.row(sql<Row>`select * from mem_assemble_hero where uid = ${targetUid}`)) ??
        resistHeroConfig!;
      const attackHeroPartInfo = [
        await this.playerHeroPart(hidOf(attackConfigNow, 'hid1'), 11),
        await this.playerHeroPart(hidOf(attackConfigNow, 'hid2'), 12),
        await this.playerHeroPart(hidOf(attackConfigNow, 'hid3'), 13),
      ];
      let resistHeroPartInfo: PkHeroEntry[];
      if (targetUid > 1000) {
        resistHeroPartInfo = [
          await this.playerHeroPart(hidOf(resistConfigNow, 'hid1'), 21),
          await this.playerHeroPart(hidOf(resistConfigNow, 'hid2'), 22),
          await this.playerHeroPart(hidOf(resistConfigNow, 'hid3'), 23),
        ];
      } else {
        // 获取NPC将领信息
        resistHeroPartInfo = [
          await this.npcHeroPart(hidOf(resistConfigNow, 'hid1'), 21),
          await this.npcHeroPart(hidOf(resistConfigNow, 'hid2'), 22),
          await this.npcHeroPart(hidOf(resistConfigNow, 'hid3'), 23),
        ];
      }
      // 每日挑战次数清零  处理这些人0点的时候没关过竞技场
      await this.resetDailyCount(ctx.uid);
      // 如果玩家今日超过10次，就得扣元宝
      const attackAssemInfo = await this.row(
        sql<Row>`select * from sys_user_assemble where uid = ${ctx.uid}`,
      );
      if (phpEmpty(attackAssemInfo)) throw GameError.lang('waigua.invalid');
      if (phpIntval(attackAssemInfo!['count']) >= 10) {
        const needMoney = (phpIntval(attackAssemInfo!['count']) - 9) * 5;
        if (
          await this.check(
            sql<Row>`select 1 as ok from sys_user where uid = ${ctx.uid} and money < ${needMoney}`,
          )
        ) {
          throw GameError.lang('buyGoods.no_enough_YuanBao');
        }
        await this.rewards.addMoney(ctx.uid, -needMoney, 620);
      }
      // 如果是首榜挑战，扣元宝
      if (targetRank <= 10) {
        // 如果玩家的排名在攻击者9名之外的，肯定是首榜挑战
        if (isSkip !== 0 || phpNum(userRankCell) > targetRank + 9) {
          if (
            !(await this.check(
              sql<Row>`select 1 as ok from sys_user where uid = ${ctx.uid} and money >= 50`,
            ))
          ) {
            throw GameError.lang('buyGoods.no_enough_YuanBao');
          }
          await this.rewards.addMoney(ctx.uid, -50, 619);
        }
      }
      const heroBaseInfo = await this.holdBattleHeroBaseInfo(
        targetUid,
        attackConfigNow,
        resistConfigNow,
      );
      const battle = this.pk.startUserPK(attackHeroPartInfo, resistHeroPartInfo);
      const ret: unknown[] = [heroBaseInfo, battle];
      const winer = Array.isArray(battle) ? undefined : battle.winer;
      const msg = await this.dealWithResult(
        winer,
        ctx.uid,
        targetUid,
        phpNum(userRankCell),
        targetRank,
        targetUserRankInfo!,
      );
      await this.updateUserArenaChallenge(ctx.uid);
      if (!Array.isArray(battle)) (battle as unknown as Row)['reward'] = msg;
      return ret;
    });
  }

  /** PKFunc.php:1356 refreshAssembleRankInfo. */
  @GlobalCommand()
  async refreshAssembleRankInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const index = phpIntval(param.shift());
      if (index !== 0 && index !== 1) throw GameError.lang('useMojiaGoods.invalid_param');
      if (!(await this.check(sql<Row>`select 1 as ok from mem_assemble where uid = ${ctx.uid}`))) {
        throw GameError.lang('assemble.user_not_exist');
      }
      if (
        !(await this.check(sql<Row>`select 1 as ok from sys_user_assemble where uid = ${ctx.uid}`))
      ) {
        throw GameError.lang('assemble.user_not_exist');
      }
      if (
        await this.check(
          sql<Row>`select 1 as ok from sys_user_assemble where uid = ${ctx.uid}
            and next_refresh_time > unix_timestamp()`,
        )
      ) {
        throw GameError.lang('assemble.refresh_cooling_exist');
      }
      const ret: unknown[] = [];
      ret.push(await this.loadUserAssembleRecord(ctx.uid));
      ret.push(await this.loadWinRecord());
      ret.push(await this.loadArenaUserData(ctx.uid, index));
      await sql`update sys_user_assemble set next_refresh_time = unix_timestamp() + 6
        where uid = ${ctx.uid}`.execute(this.scope.db);
      return ret;
    });
  }

  /** PKFunc.php:1372 gotoSelectedRank — costs `gotoRank` 元宝. */
  @GlobalCommand()
  async gotoSelectedRank(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const gotoRank = phpIntval(param.shift());
      if (![50, 100, 200, 300, 500].includes(gotoRank)) {
        throw GameError.lang('assemble.goto_rank_error');
      }
      const userRankCell = await this.cell(
        sql<Row>`select \`rank\` as v from mem_assemble where uid = ${ctx.uid}`,
      );
      if (phpEmpty(userRankCell)) throw GameError.lang('assemble.user_not_exist');
      const userRank = phpNum(userRankCell);
      if (phpIntval(userRankCell) === gotoRank) throw GameError.lang('assemble.goto_not_need');
      const maxRank = await this.cell(sql<Row>`select max(\`rank\`) as v from mem_assemble`);
      if (gotoRank > phpIntval(maxRank)) {
        throw GameError.raw(this.lang.t('assemble.goto_over_max', phpIntval(maxRank)));
      }
      if (
        await this.check(
          sql<Row>`select 1 as ok from sys_user where uid = ${ctx.uid} and money < ${gotoRank}`,
        )
      ) {
        throw GameError.lang('buyGoods.no_enough_YuanBao');
      }
      await this.rewards.addMoney(ctx.uid, -gotoRank, 619);
      if (userRank > gotoRank) {
        // 往上爬
        await this.updatePartUserRank(userRank, gotoRank, true);
        if (
          await this.check(
            sql<Row>`select 1 as ok from sys_user_assemble where uid = ${ctx.uid} and maxrank > ${gotoRank}`,
          )
        ) {
          await sql`update sys_user_assemble set maxrank = ${gotoRank}
            where uid = ${ctx.uid}`.execute(this.scope.db);
        }
      } else {
        // 往下爬
        await this.updatePartUserRank(gotoRank, userRank, false);
      }
      await sql`update sys_user_assemble set \`rank\` = ${gotoRank}
        where uid = ${ctx.uid}`.execute(this.scope.db);
      await sql`update mem_assemble set \`rank\` = ${gotoRank}
        where uid = ${ctx.uid}`.execute(this.scope.db);
      const userRankInfoRow = await this.row(
        sql<Row>`select \`rank\`, maxrank from sys_user_assemble where uid = ${ctx.uid}`,
      );
      return [
        phpEmpty(userRankInfoRow) ? null : userRankInfoRow,
        await this.loadArenaUserData(ctx.uid, 0),
      ];
    });
  }

  /** PKFunc.php:1292 clearArenaCoolTime — 10 元宝 per clear. */
  @GlobalCommand()
  async clearArenaCoolTime(ctx: CommandContext): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      if (
        !(await this.check(
          sql<Row>`select 1 as ok from sys_user_assemble where uid = ${ctx.uid}
            and next_challenge_time > unix_timestamp()`,
        ))
      ) {
        throw GameError.lang('assemble.time_not_cooling');
      }
      if (
        !(await this.check(
          sql<Row>`select 1 as ok from sys_user where uid = ${ctx.uid} and money >= 10`,
        ))
      ) {
        throw GameError.lang('buyGoods.no_enough_YuanBao');
      }
      await this.rewards.addMoney(ctx.uid, -10, 619);
      await sql`update sys_user_assemble set next_challenge_time = unix_timestamp()
        where uid = ${ctx.uid}`.execute(this.scope.db);
      // 随便传个参数告诉客户端
      return [1];
    });
  }

  /** PKFunc.php:1306 getArenaReward — claim the 5-hour defensive reward. */
  @GlobalCommand()
  async getArenaReward(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const rewardUid = phpIntval(param.shift());
      if (rewardUid !== ctx.uid) throw GameError.lang('assemble.reward_target_error');
      const userArenaInfo = await this.row(
        sql<Row>`select * from mem_assemble where uid = ${ctx.uid}`,
      );
      if (phpEmpty(userArenaInfo)) throw GameError.lang('assemble.user_not_exist');
      if (
        await this.check(
          sql<Row>`select 1 as ok from mem_assemble where uid = ${ctx.uid} and endtime > unix_timestamp()`,
        )
      ) {
        throw GameError.lang('assemble.reward_cooling_exist');
      }
      const rewardObj = await this.addAttackArenaReward(ctx.uid, userArenaInfo!);
      const subRet: unknown[] = [];
      if (rewardObj['info'] !== null && typeof rewardObj['info'] === 'object') {
        const info = rewardObj['info'] as Row;
        info['flag'] = rewardObj['flag'];
        info['count'] = rewardObj['count'];
        info['gtype'] = rewardObj['gtype'];
        subRet.push(1);
        // 为了套用原来的物品弹出框，这里再套一层
        subRet.push([info]);
      } else {
        subRet.push(0);
        subRet.push(`${phpString(rewardObj['info'])}*${phpString(rewardObj['count'])}`);
      }
      await this.resetResistArenaReward(ctx.uid);
      return [subRet];
    });
  }

  /** PKFunc.php:1146 getArenaRankRewardInfo. */
  @GlobalCommand()
  async getArenaRankRewardInfo(ctx: CommandContext): Promise<unknown[]> {
    const rankBefore3UserInfoTmps = await this.rows(
      sql<Row>`select \`rank\`, uid as userid, name from log_assemble_reward where \`rank\` <= 3`,
    );
    const rankBefore3UserInfo: Row[] = [];
    for (const tmp of rankBefore3UserInfoTmps) {
      const rUid = tmp['userid'];
      let kingLevel = await this.cell(
        sql<Row>`select level as v from sys_user_level where uid = ${rUid}`,
      );
      if (phpEmpty(kingLevel)) kingLevel = 0;
      tmp['level'] = kingLevel;
      rankBefore3UserInfo.push(tmp);
    }
    const rankRewardConfArr = await this.rows(
      sql<Row>`select * from cfg_activity_rank_reward where actid = '1000001'`,
    );
    const rankRewardArr = await this.parseRewardGood(rankRewardConfArr);
    const userRankRow = await this.row(
      sql<Row>`select \`rank\`, reward from log_assemble_reward where uid = ${ctx.uid}`,
    );
    const userRank = phpEmpty(userRankRow) ? null : userRankRow;
    return [rankBefore3UserInfo, phpEmpty(rankRewardArr) ? [] : rankRewardArr, userRank];
  }

  /** PKFunc.php:1274 getArenaRankReward. */
  @GlobalCommand()
  async getArenaRankReward(ctx: CommandContext): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const userRankInfo = await this.row(
        sql<Row>`select * from log_assemble_reward where uid = ${ctx.uid}`,
      );
      if (phpEmpty(userRankInfo)) throw GameError.lang('assemble.reward_not_exist');
      if (phpIntval(userRankInfo!['reward']) > 0) throw GameError.lang('king.has_get_reward');
      const rank = userRankInfo!['rank'];
      const rewardInfo = await this.cell(
        sql<Row>`select reward as v from cfg_activity_rank_reward
          where actid = '1000001' and minrank <= ${phpIntval(rank)} and maxrank >= ${phpIntval(rank)}`,
      );
      if (phpEmpty(rewardInfo)) throw GameError.lang('kingReward.not_find_data');
      const ret: unknown[] = [];
      await sql`update log_assemble_reward set reward = '1', time = unix_timestamp()
        where uid = ${ctx.uid}`.execute(this.scope.db);
      ret.push(rank);
      ret.push(
        await this.grant.parseAndAddReward(ctx.uid, phpString(rewardInfo), ARENA_REWARD_LOG),
      );
      return ret;
    });
  }

  // ---- internals (not whitelisted) ----

  /** PKFunc.php:746 initUserAssemBleInfo — first entry ranks max(rank)+1. */
  private async initUserAssembleInfo(uid: number): Promise<void> {
    let maxRank = await this.cell(sql<Row>`select max(\`rank\`) as v from mem_assemble`);
    if (phpEmpty(maxRank)) maxRank = 0;
    const userRank = phpIntval(maxRank) + 1;
    let kingLevel = await this.cell(
      sql<Row>`select level as v from sys_city_hero where uid = ${uid} and herotype = '1000'`,
    );
    if (phpEmpty(kingLevel)) kingLevel = 1;
    await sql`insert into mem_assemble (\`rank\`, uid, level)
      values (${userRank}, ${uid}, ${kingLevel})`.execute(this.scope.db);
    await this.resetResistArenaReward(uid);
  }

  /**
   * PKFunc.php:727-731/902-907 — the daily count reset compares the DB clock against
   * `next_challenge_time - 600` (i.e. the reset ran when the last challenge was before
   * midnight); quirk kept verbatim.
   */
  private async resetDailyCount(uid: number): Promise<void> {
    const currentZeroTime = await this.cell(sql<Row>`select unix_timestamp(curDate()) as v`);
    const userLastChallengTime = await this.cell(
      sql<Row>`select next_challenge_time - 600 as v from sys_user_assemble where uid = ${uid}`,
    );
    if (phpIntval(currentZeroTime) >= phpIntval(userLastChallengTime)) {
      await sql`update sys_user_assemble set count = '0' where uid = ${uid}`.execute(this.scope.db);
    }
  }

  /** PKFunc.php:756 loadWinRecord — the streak announcements, newest 10. */
  private async loadWinRecord(): Promise<Row[]> {
    const tmps = await this.rows(
      sql<Row>`select * from mem_assemble_win_record order by last_challenge_time desc limit 10`,
    );
    const ret: Row[] = [];
    for (const rec of tmps) {
      rec['fromnameWin'] = await this.cell(
        sql<Row>`select name as v from sys_user where uid = ${rec['fromuid']}`,
      );
      rec['tonameWin'] = await this.cell(
        sql<Row>`select name as v from sys_user where uid = ${rec['touid']}`,
      );
      rec['fromKingLevel'] = await this.cell(
        sql<Row>`select level as v from sys_user_level where uid = ${rec['fromuid']}`,
      );
      rec['toKingLevel'] = rec['rKingLevel'];
      ret.push(rec);
    }
    return ret;
  }

  /** PKFunc.php:773 loadUserAssembleRecord — the own challenge records, newest 10. */
  private async loadUserAssembleRecord(uid: number): Promise<Row[]> {
    const tmps = await this.rows(
      sql<Row>`select * from mem_assemble_record where fromuid = ${uid} or touid = ${uid}
        order by time desc limit 10`,
    );
    const ret: Row[] = [];
    for (const rec of tmps) {
      rec['fromname'] = await this.cell(
        sql<Row>`select name as v from sys_user where uid = ${rec['fromuid']}`,
      );
      rec['fromKingLevel'] = await this.cell(
        sql<Row>`select level as v from sys_user_level where uid = ${rec['fromuid']}`,
      );
      rec['toKingLevel'] = rec['rKingLevel'];
      if (phpIntval(rec['touid']) > 1000) {
        rec['toname'] = await this.cell(
          sql<Row>`select name as v from sys_user where uid = ${rec['touid']}`,
        );
        rec['rewardname'] = await this.cell(
          sql<Row>`select name as v from cfg_assemble_reward where gid = ${rec['rewardid']}`,
        );
      } else {
        rec['toname'] = this.lang.t('assemble.special_hero_name');
        rec['rewardname'] = await this.cell(
          sql<Row>`select name as v from cfg_goods where gid = ${rec['rewardid']}`,
        );
      }
      ret.push(rec);
    }
    return ret;
  }

  /** PKFunc.php:797 loadArenaUserData — index 0 竞技挑战, 1 首榜挑战. */
  private async loadArenaUserData(uid: number, index: number): Promise<unknown[]> {
    const assembleRankInfoArr: unknown[] = [];
    let npcPos = await this.cell(sql<Row>`select \`rank\` as v from mem_assemble where uid < 1000`);
    if (phpEmpty(npcPos)) npcPos = 0;
    assembleRankInfoArr.push(npcPos);
    let assembleRankInfoTmp: Row[] = [];
    if (index === 0) {
      // 加载"竞技挑战"10名玩家的数据
      const userRank = await this.cell(
        sql<Row>`select \`rank\` as v from mem_assemble where uid = ${uid}`,
      );
      if (phpIntval(userRank) <= 10) {
        assembleRankInfoTmp = await this.rows(rankWindow(undefined));
      } else {
        const startIndex = phpIntval(userRank) - 10;
        assembleRankInfoTmp = await this.rows(rankWindow(startIndex));
      }
    } else if (index === 1) {
      // 加载"首榜挑战"10名玩家的数据
      assembleRankInfoTmp = await this.rows(rankWindow(undefined));
    }
    for (const info of assembleRankInfoTmp) {
      let rewardInfo: Row | false;
      let kingLevel: unknown;
      let username: unknown;
      if (phpIntval(info['uid']) > 1000) {
        rewardInfo =
          (await this.row(
            sql<Row>`select name, base from cfg_assemble_reward where gid = ${info['rewardid']}`,
          )) ?? false;
        kingLevel = await this.cell(
          sql<Row>`select level as v from sys_user_level where uid = ${info['uid']}`,
        );
        username = await this.cell(
          sql<Row>`select name as v from sys_user where uid = ${info['uid']}`,
        );
      } else {
        rewardInfo =
          (await this.row(
            sql<Row>`select h.rewardcount as base, g.name, type from cfg_assemble_special_hero h,
              cfg_goods g where h.rewardid = g.gid and h.rewardid = ${info['rewardid']}
              and h.isopen = '1'`,
          )) ?? false;
        // PHP reads the type off a possibly-false row: null there.
        kingLevel = fieldOf(rewardInfo, 'type');
        username = this.lang.t('assemble.special_hero_name');
      }
      info['username'] = username;
      info['rewardname'] = fieldOf(rewardInfo, 'name');
      info['userid'] = info['uid'];
      info['base'] = fieldOf(rewardInfo, 'base');
      info['kingLevel'] = kingLevel;
      if (phpIntval(info['uid']) === uid) {
        info['canGetRewardCount'] = await this.doCaulRewardCount(
          true,
          info['endtime'],
          fieldOf(rewardInfo, 'base'),
        );
      } else {
        info['canGetRewardCount'] = await this.doCaulRewardCount(
          false,
          info['endtime'],
          fieldOf(rewardInfo, 'base'),
        );
      }
      assembleRankInfoArr.push(info);
    }
    return assembleRankInfoArr;
  }

  /** PKFunc.php:689 body — shared by the command and loadArenaBattleInitData. */
  private async loadUserBattleHeroRows(uid: number): Promise<unknown[]> {
    const ret: unknown[] = [];
    const hids = await this.row(
      sql<Row>`select hid1, hid2, hid3 from mem_assemble_hero where uid = ${uid}`,
    );
    // PHP `!empty($hids)`: a fetched row object is never empty, only the no-row case is.
    if (hids !== undefined) {
      const hero1Info = await this.fullHeroRow(hids['hid1'], uid);
      const hero2Info = await this.fullHeroRow(hids['hid2'], uid);
      const hero3Info = await this.fullHeroRow(hids['hid3'], uid);
      if (!phpEmpty(hero1Info)) ret.push(hero1Info);
      if (!phpEmpty(hero2Info)) ret.push(hero2Info);
      if (!phpEmpty(hero3Info)) ret.push(hero3Info);
    }
    return ret;
  }

  /** PKFunc.php:936 holdBattleHeroBaseInfo — the six full rows the client renders. */
  private async holdBattleHeroBaseInfo(
    targetUid: number,
    attackHeroConfig: Row,
    resistHeroConfig: Row,
  ): Promise<unknown[]> {
    const heroArr: unknown[] = [];
    heroArr.push(await this.fullHeroRow(attackHeroConfig['hid1'], undefined));
    heroArr.push(await this.fullHeroRow(attackHeroConfig['hid2'], undefined));
    heroArr.push(await this.fullHeroRow(attackHeroConfig['hid3'], undefined));
    if (phpIntval(targetUid) > 1000) {
      heroArr.push(await this.fullHeroRow(resistHeroConfig['hid1'], undefined));
      heroArr.push(await this.fullHeroRow(resistHeroConfig['hid2'], undefined));
      heroArr.push(await this.fullHeroRow(resistHeroConfig['hid3'], undefined));
    } else {
      heroArr.push(await this.npcFullHeroRow(resistHeroConfig['hid1']));
      heroArr.push(await this.npcFullHeroRow(resistHeroConfig['hid2']));
      heroArr.push(await this.npcFullHeroRow(resistHeroConfig['hid3']));
    }
    return heroArr;
  }

  /** PKFunc.php:953 checkHero — repairs stale configs; the defender's replacement pair rolls. */
  private async checkHero(
    attackUid: number,
    attackHeroInfo: Row,
    resistUid: number,
    resistHeroInfo: Row,
  ): Promise<void> {
    const aHid1 = phpIntval(attackHeroInfo['hid1']);
    const aHid2 = phpIntval(attackHeroInfo['hid2']);
    const aHid3 = phpIntval(attackHeroInfo['hid3']);
    const rHid1 = phpIntval(resistHeroInfo['hid1']);
    const rHid2 = phpIntval(resistHeroInfo['hid2']);
    const rHid3 = phpIntval(resistHeroInfo['hid3']);
    const rUid = phpIntval(resistHeroInfo['uid']);
    // 必须包含君主将
    const attackKingHid = await this.cell(
      sql<Row>`select hid as v from sys_city_hero where uid = ${attackUid} and herotype = '1000'`,
    );
    if (phpEmpty(attackKingHid)) throw GameError.lang('useGoods.king_cannot_find');
    if (![aHid1, aHid2, aHid3].includes(phpIntval(attackKingHid))) {
      throw GameError.lang('assemble.king_not_in');
    }
    const attackConfigHeroCount = phpIntval(
      await this.cell(
        sql<Row>`select count(1) as v from sys_city_hero where uid = ${attackUid}
          and hid in (${aHid1}, ${aHid2}, ${aHid3})`,
      ),
    );
    if (attackConfigHeroCount === 1 || attackConfigHeroCount === 2) {
      const attackOwnHeroCount = phpIntval(
        await this.cell(
          sql<Row>`select count(hid) as v from sys_city_hero where uid = ${attackUid}`,
        ),
      );
      // 大于三个将领，要求玩家重新配置，否则默认三个君主将
      if (attackOwnHeroCount >= 3) {
        throw GameError.lang('assemble.need_change_hero');
      }
      await sql`update mem_assemble_hero set hid1 = ${attackKingHid}, hid2 = ${attackKingHid},
        hid3 = ${attackKingHid} where uid = ${attackUid}`.execute(this.scope.db);
    }
    // 防守方   系统刷出来的 就不做处理了
    if (rUid > 1000) {
      const resistKingHid = await this.cell(
        sql<Row>`select hid as v from sys_city_hero where uid = ${resistUid} and herotype = '1000'`,
      );
      if (phpEmpty(resistKingHid)) throw GameError.lang('assemble.resist_hero_error');
      let r1 = rHid1;
      if (![rHid1, rHid2, rHid3].includes(phpIntval(resistKingHid))) {
        await sql`update mem_assemble_hero set hid1 = ${resistKingHid}
          where uid = ${resistUid}`.execute(this.scope.db);
        r1 = phpIntval(resistKingHid);
      }
      const resistConfigHeroCount = phpIntval(
        await this.cell(
          sql<Row>`select count(1) as v from sys_city_hero where uid = ${resistUid}
            and hid in (${r1}, ${rHid2}, ${rHid3})`,
        ),
      );
      if (resistConfigHeroCount === 1 || resistConfigHeroCount === 2) {
        const resistHeroHidArr = await this.rows(
          sql<Row>`select hid from sys_city_hero where uid = ${resistUid} and herotype != 1000`,
        );
        if (resistHeroHidArr.length >= 2) {
          // PHP array_rand picks two distinct keys with the C-level php_rand(), which the
          // difftest rng prepend cannot intercept — this repair path stays unfixed random.
          const first = this.arrayRandKey(resistHeroHidArr.length);
          let second = this.arrayRandKey(resistHeroHidArr.length);
          while (second === first) second = this.arrayRandKey(resistHeroHidArr.length);
          const hid2Tmp = phpIntval(resistHeroHidArr[first]!['hid']);
          const hid3Tmp = phpIntval(resistHeroHidArr[second]!['hid']);
          await sql`update mem_assemble_hero set hid2 = ${hid2Tmp}, hid3 = ${hid3Tmp}
            where uid = ${resistUid}`.execute(this.scope.db);
        } else {
          await sql`update mem_assemble_hero set hid2 = ${resistKingHid}, hid3 = ${resistKingHid}
            where uid = ${resistUid}`.execute(this.scope.db);
        }
      }
    }
  }

  /** PHP 5 `array_rand` key: `(long)(len * rand() / (PHP_RAND_MAX + 1))` (RAND_RANGE). */
  private arrayRandKey(len: number): number {
    return Math.floor(len * (this.random.rand() / 2147483648));
  }

  /** PKFunc.php:1003 updateUserArenaChallenge. */
  private async updateUserArenaChallenge(attackUid: number): Promise<void> {
    await sql`update sys_user_assemble set count = count + 1
      where uid = ${attackUid}`.execute(this.scope.db);
    await sql`update sys_user_assemble set next_challenge_time = unix_timestamp() + 600
      where uid = ${attackUid}`.execute(this.scope.db);
  }

  /**
   * PKFunc.php:1008 dealWithResult — the ranking shuffle, the streak announcements, the reward
   * grant and the record row. `resistNewRank` only matters on the win path.
   */
  private async dealWithResult(
    isWin: unknown,
    attackUid: number,
    resistUid: number,
    attackRank: number,
    resistRank: number,
    resistArenaInfo: Row,
  ): Promise<unknown[]> {
    const winArray = [3, 5, 10, 15, 30];
    if (
      !(await this.check(sql<Row>`select 1 as ok from sys_user_assemble where uid = ${attackUid}`))
    ) {
      await sql`insert into sys_user_assemble (uid, \`rank\`, maxrank)
        select ${attackUid}, \`rank\`, \`rank\` from mem_assemble where uid = ${attackUid}`.execute(
        this.scope.db,
      );
    }
    if (
      !(await this.check(sql<Row>`select 1 as ok from sys_user_assemble where uid = ${resistUid}`))
    ) {
      await sql`insert into sys_user_assemble (uid, \`rank\`, maxrank)
        select ${resistUid}, \`rank\`, \`rank\` from mem_assemble where uid = ${resistUid}`.execute(
        this.scope.db,
      );
    }
    const ret: unknown[] = [];
    const attackName = await this.cell(
      sql<Row>`select name as v from sys_user where uid = ${attackUid}`,
    );
    let rKingLevel: unknown;
    if (phpIntval(resistUid) > 1000) {
      rKingLevel = await this.cell(
        sql<Row>`select level as v from sys_user_level where uid = ${resistUid}`,
      );
      if (phpEmpty(rKingLevel)) rKingLevel = 0;
    } else {
      rKingLevel = await this.cell(
        sql<Row>`select type as v from cfg_assemble_special_hero where isopen = '1'`,
      );
      if (phpEmpty(rKingLevel)) rKingLevel = 0;
    }
    let resistNewRank = resistRank;
    if (isWin) {
      const attackNewRank = attackRank > resistRank ? resistRank : attackRank; // 新排名取小值
      if (
        await this.check(
          sql<Row>`select 1 as ok from sys_user_assemble where uid = ${attackUid}
            and \`rank\` > ${attackNewRank}`,
        )
      ) {
        resistNewRank = resistRank + 1; // 防守方排名往后退一位
        const userCurRank = phpIntval(
          await this.cell(
            sql<Row>`select \`rank\` as v from sys_user_assemble where uid = ${attackUid}`,
          ),
        );
        if (phpIntval(resistUid) > 1000) {
          await this.updatePartUserRank(userCurRank, attackNewRank, true);
          await sql`update sys_user_assemble set \`rank\` = ${attackNewRank}
            where uid = ${attackUid}`.execute(this.scope.db);
          await sql`update mem_assemble set \`rank\` = ${attackNewRank}
            where uid = ${attackUid}`.execute(this.scope.db);
        } else {
          await sql`update mem_assemble set \`rank\` = ${resistRank}
            where uid = ${attackUid}`.execute(this.scope.db);
          await sql`update sys_user_assemble set \`rank\` = ${resistRank}
            where uid = ${attackUid}`.execute(this.scope.db);
          await sql`delete from mem_assemble where uid = ${resistUid}`.execute(this.scope.db);
          // With no row left max(rank) is NULL and the original interpolation breaks the SQL;
          // the port reads it as 0 (empty range) instead of dying.
          const maxRank = await this.cell(sql<Row>`select max(\`rank\`) as v from mem_assemble`);
          await this.updatePartUserRank(maxRank, attackRank, false);
        }
      } else if (phpIntval(resistUid) < 1000) {
        await sql`delete from mem_assemble where uid = ${resistUid}`.execute(this.scope.db);
        const maxRank = await this.cell(sql<Row>`select max(\`rank\`) as v from mem_assemble`);
        await this.updatePartUserRank(maxRank, resistRank, false);
      }
      if (
        await this.check(
          sql<Row>`select 1 as ok from sys_user_assemble where uid = ${attackUid}
            and maxrank > ${attackNewRank}`,
        )
      ) {
        // 更新最高排名
        await sql`update sys_user_assemble set maxrank = ${attackNewRank}
          where uid = ${attackUid}`.execute(this.scope.db);
      }
      // A loss writes times=0, so the streak reads the last record — a loss resets it.
      let winTimes = phpIntval(
        await this.cell(
          sql<Row>`select times as v from mem_assemble_record where fromuid = ${attackUid}
            order by time desc limit 1`,
        ),
      );
      winTimes++;
      if (winArray.includes(winTimes)) {
        // 连胜记录公告
        await sql`insert into mem_assemble_win_record
          (fromuid, touid, times, rKingLevel, last_challenge_time)
          values (${attackUid}, ${resistUid}, ${winTimes}, ${rKingLevel}, unix_timestamp())`.execute(
          this.scope.db,
        );
        const chatMsg = this.parseWinChatInform(winTimes, attackName);
        if (chatMsg.length > 0) {
          await this.users.sendSysInform({
            type: 0,
            inuse: 1,
            starttime: 0,
            endtime: 600,
            interval: 50000,
            scrollcount: 1,
            color: 49151,
            msg: chatMsg,
          });
        }
      }
      const currentMaxWinRecord = await this.cell(
        sql<Row>`select maxwin as v from sys_user_assemble where uid = ${attackUid}`,
      );
      if (winTimes > phpIntval(currentMaxWinRecord)) {
        // 更新玩家的连胜记录
        await sql`update sys_user_assemble set maxwin = ${winTimes}
          where uid = ${attackUid}`.execute(this.scope.db);
      }
      const rewardTypeBase = await this.cell(
        sql<Row>`select base as v from cfg_assemble_reward where gid = ${resistArenaInfo['rewardid']}`,
      );
      // Original: intval($resistUid>1000) — the comparison sits inside intval().
      let rewardCount: unknown;
      if (phpIntval(resistUid) > 1000) {
        rewardCount = await this.doCaulRewardCount(
          false,
          phpIntval(resistArenaInfo['endtime']),
          phpIntval(rewardTypeBase),
        );
      } else {
        rewardCount = resistArenaInfo['count'];
      }
      const isChange = attackNewRank !== attackRank ? 1 : 0;
      if (
        await this.check(
          sql<Row>`select 1 as ok from mem_assemble where uid = ${resistArenaInfo['uid']}
            and endtime < unix_timestamp()`,
        )
      ) {
        // 如果对方已经过了倒计时时间就拿不到奖励
        await sql`insert into mem_assemble_record
          (fromuid, touid, flag, rewardcount, time, times, attackrank, resistrank, ischange, rKingLevel)
          values (${attackUid}, ${resistUid}, '1', '0', unix_timestamp(), ${winTimes},
            ${attackNewRank}, ${resistNewRank}, ${isChange}, ${rKingLevel})`.execute(this.scope.db);
      } else {
        await sql`insert into mem_assemble_record
          (fromuid, touid, flag, rewardid, rewardcount, time, times, attackrank, resistrank, ischange, rKingLevel)
          values (${attackUid}, ${resistUid}, '1', ${resistArenaInfo['rewardid']}, ${rewardCount},
            unix_timestamp(), ${winTimes}, ${attackNewRank}, ${resistNewRank}, ${isChange}, ${rKingLevel})`.execute(
          this.scope.db,
        );
        // 攻击方拿奖励
        ret.push(await this.addAttackArenaReward(attackUid, resistArenaInfo));
        if (phpIntval(resistArenaInfo['uid']) > 1000) {
          await this.resetResistArenaReward(resistUid); // 重置防守方竞技场奖励
        }
      }
      // 打的是系统将领
      if (phpIntval(resistUid) < 1000) {
        await sql`update cfg_assemble_special_hero set isopen = '0'`.execute(this.scope.db);
        await sql`delete from mem_assemble_hero where uid < 1000`.execute(this.scope.db);
        const npcMsg = this.lang.t('assemble.attack_npc_succ_inform', phpString(attackName));
        await this.users.sendSysInform({
          type: 0,
          inuse: 1,
          starttime: 0,
          endtime: 600,
          interval: 50000,
          scrollcount: 1,
          color: 16247152,
          msg: npcMsg,
        });
      }
    } else {
      await sql`insert into mem_assemble_record
        (fromuid, touid, flag, time, times, attackrank, resistrank, rKingLevel)
        values (${attackUid}, ${resistUid}, '0', unix_timestamp(), '0', ${attackRank},
          ${resistRank}, ${rKingLevel})`.execute(this.scope.db);
    }
    // 是否需要发聊天公告
    if (attackRank > resistRank) {
      const resistName = await this.cell(
        sql<Row>`select name as v from sys_user where uid = ${resistUid}`,
      );
      let msg = '';
      if (isWin && resistRank <= 10) {
        msg = this.lang.t(
          'assemble.attack_succ_inform',
          phpString(attackName),
          resistRank,
          phpString(resistName),
        );
      }
      if (!isWin && resistRank <= 10) {
        msg = this.lang.t(
          'assemble.resist_succ_inform',
          resistRank,
          phpString(resistName),
          phpString(attackName),
        );
      }
      if (msg.length > 0) {
        await this.users.sendSysInform({
          type: 0,
          inuse: 1,
          starttime: 0,
          endtime: 600,
          interval: 50000,
          scrollcount: 1,
          color: 16247152,
          msg,
        });
      }
    }
    return ret;
  }

  /**
   * PKFunc.php:1117 updatePartUserRank — the original moves each affected row with its own
   * re-read + UPDATE instead of one shift statement; kept row by row.
   */
  private async updatePartUserRank(
    maxValueRank: unknown,
    minValueRank: unknown,
    isUp: boolean,
  ): Promise<void> {
    if (isUp) {
      const endValueRank = phpNum(maxValueRank) - 1; // 踢掉用户自己这条数据
      const updateUserUps = await this.rows(
        sql<Row>`select uid, \`rank\` from mem_assemble
          where \`rank\` between ${phpNum(minValueRank)} and ${endValueRank} order by \`rank\` asc`,
      );
      for (const up of updateUserUps) {
        const currentRankUp = phpIntval(
          await this.cell(
            sql<Row>`select \`rank\` as v from mem_assemble where uid = ${up['uid']}`,
          ),
        );
        const nextRank = currentRankUp + 1;
        await sql`update mem_assemble set \`rank\` = ${nextRank}
          where uid = ${up['uid']}`.execute(this.scope.db);
        await sql`update sys_user_assemble set \`rank\` = ${nextRank}
          where uid = ${up['uid']}`.execute(this.scope.db);
      }
    } else {
      const startValueRank = phpNum(minValueRank) + 1; // 踢掉用户自己这条数据
      const updateUserDowns = await this.rows(
        sql<Row>`select uid, \`rank\` from mem_assemble
          where \`rank\` between ${startValueRank} and ${phpNum(maxValueRank)} order by \`rank\` asc`,
      );
      for (const down of updateUserDowns) {
        const currentRankDown = phpIntval(
          await this.cell(
            sql<Row>`select \`rank\` as v from mem_assemble where uid = ${down['uid']}`,
          ),
        );
        const preRank = currentRankDown - 1;
        await sql`update mem_assemble set \`rank\` = ${preRank}
          where uid = ${down['uid']}`.execute(this.scope.db);
        await sql`update sys_user_assemble set \`rank\` = ${preRank}
          where uid = ${down['uid']}`.execute(this.scope.db);
        // 检测下是否需要更新玩家的最高排名
        if (
          await this.check(
            sql<Row>`select 1 as ok from sys_user_assemble where maxrank > ${preRank}
              and uid = ${down['uid']}`,
          )
        ) {
          await sql`update sys_user_assemble set maxrank = ${preRank}
            where uid = ${down['uid']}`.execute(this.scope.db);
        }
      }
    }
  }

  /** PKFunc.php:1171 addAttackArenaReward — goods / armor / (-1 gold, -2 food, -3 wood). */
  private async addAttackArenaReward(attackUid: number, resistArenaInfo: Row): Promise<Row> {
    const lastCid = await this.cell(
      sql<Row>`select lastcid as v from sys_user where uid = ${attackUid}`,
    );
    const rewardGid = phpIntval(resistArenaInfo['rewardid']);
    let rewardType: Row | undefined;
    let rewardCount: unknown;
    if (phpIntval(resistArenaInfo['uid']) > 1000) {
      rewardType = await this.row(
        sql<Row>`select type, base from cfg_assemble_reward where gid = ${resistArenaInfo['rewardid']}`,
      );
      if (!rewardType) throw GameError.lang('hero.xidian_unvalid');
      rewardCount = await this.doCaulRewardCount(
        false,
        phpIntval(resistArenaInfo['endtime']),
        phpIntval(rewardType['base']),
      );
    } else {
      rewardCount = resistArenaInfo['count'];
    }
    const rewardArray: Row = {};
    if (phpIntval(resistArenaInfo['uid']) < 1000 || phpIntval(rewardType?.['type']) === 0) {
      await this.goods.addGoods(attackUid, rewardGid, phpNum(rewardCount), 619);
      rewardArray['flag'] = 0;
      rewardArray['info'] =
        (await this.row(sql<Row>`select * from cfg_goods where gid = ${rewardGid}`)) ?? false;
      rewardArray['count'] = rewardCount;
      rewardArray['gtype'] = 0;
    } else if (phpIntval(rewardType?.['type']) === 1) {
      const armor =
        (await this.row(sql<Row>`select * from cfg_armor where id = ${rewardGid}`)) ?? false;
      await this.rewards.addArmor(attackUid, rewardGid, phpNum(rewardCount), 619);
      rewardArray['flag'] = 1;
      rewardArray['info'] = armor;
      rewardArray['count'] = rewardCount;
      rewardArray['gtype'] = 1;
    } else if (phpIntval(rewardType?.['type']) === 2) {
      if (rewardGid === -1) {
        await this.cities.addCityResources(phpIntval(lastCid), 0, 0, 0, 0, phpNum(rewardCount));
      } else if (rewardGid === -2) {
        await this.cities.addCityResources(phpIntval(lastCid), 0, 0, 0, phpNum(rewardCount), 0);
      } else if (rewardGid === -3) {
        await this.cities.addCityResources(phpIntval(lastCid), phpNum(rewardCount), 0, 0, 0, 0);
      }
      rewardArray['flag'] = 2;
      rewardArray['info'] = await this.cell(
        sql<Row>`select name as v from cfg_assemble_reward where gid = ${resistArenaInfo['rewardid']}`,
      );
      rewardArray['count'] = rewardCount;
    }
    return rewardArray;
  }

  /** PKFunc.php:1212 doCaulRewardCount — the 5-hour linear decay from the reward clock. */
  private async doCaulRewardCount(
    isUser: boolean,
    endtime: unknown,
    rewardTypeBase: unknown,
  ): Promise<number> {
    if (isUser) {
      // 玩家自己的奖励一次性算好
      return phpNum(rewardTypeBase) * 5;
    }
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as v`));
    const lefttime = phpNum(endtime) - now;
    let multiple = (18000 - lefttime) / 3600;
    if (multiple > 5.0) multiple = 5.0; // 奖励最高累计5小时
    return Math.max(Math.floor(phpNum(rewardTypeBase) * multiple), 0);
  }

  /** PKFunc.php:1226 resetResistArenaReward — one mt_rand(1,100) roll over the rate table. */
  private async resetResistArenaReward(uid: number): Promise<void> {
    const rewardInfos = await this.rows(sql<Row>`select * from cfg_assemble_reward`);
    const rate = this.random.mtRand(1, 100);
    let sum = 0;
    let gid: unknown = -10;
    let count: unknown = 0;
    for (const rewardInfo of rewardInfos) {
      sum += phpIntval(rewardInfo['rate']);
      if (sum >= rate) {
        gid = rewardInfo['gid'];
        count = rewardInfo['base'];
        break;
      }
    }
    const endtime = phpNum(await this.cell(sql<Row>`select unix_timestamp() as v`));
    await sql`update mem_assemble set rewardid = ${gid}, count = ${count}, endtime = ${endtime + 18000}
      where uid = ${uid}`.execute(this.scope.db); // 5小时倒计时
  }

  /** PKFunc.php:1245 parseRewardGood — the flat `[rankIndex, reward, rankIndex, reward, ...]`. */
  private async parseRewardGood(rewardArr: Row[]): Promise<unknown[]> {
    const rewardObjArr: unknown[] = [];
    let rankIndex = 1;
    for (const rewardObj of rewardArr) {
      const goods = phpString(rewardObj['reward']).split(',');
      const goodcnt = phpIntval(goods[0]);
      let goodObj: Row | false | undefined;
      for (let i = 1; i < goodcnt * 3; i += 3) {
        // 只会循环一次，每个奖励都是一个good或armor
        const type = goods[i];
        const gid = goods[i + 1];
        const cnt = goods[i + 2];
        if (phpLooseEquals(type, 0)) {
          goodObj =
            (await this.row(sql<Row>`select * from cfg_goods where gid = ${phpIntval(gid)}`)) ??
            false;
        } else if (phpLooseEquals(type, 1)) {
          goodObj =
            (await this.row(sql<Row>`select * from cfg_armor where id = ${phpIntval(gid)}`)) ??
            false;
        }
        // A missing row (false) or the first assignment auto-vivifies into a fresh array.
        goodObj = goodObj && typeof goodObj === 'object' ? goodObj : {};
        // The exploded parts stay strings, like PHP's json of them.
        goodObj['rewardType'] = type;
        goodObj['rewardCount'] = cnt;
        goodObj['minrank'] = rewardObj['minrank'];
        goodObj['maxrank'] = rewardObj['maxrank'];
      }
      rewardObjArr.push(rankIndex);
      // An unused $goodObj pushes PHP's null (goodcnt=0).
      rewardObjArr.push(goodObj === undefined ? null : goodObj);
      rankIndex++;
    }
    return rewardObjArr;
  }

  /** PKFunc.php:1332 parseWinChatInform — the 3/5/10/15/30 streak texts. */
  private parseWinChatInform(winTimes: number, attackName: unknown): string {
    switch (phpIntval(winTimes)) {
      case 3:
        return this.lang.t('assemble.attack_succ_inform_3', phpString(attackName));
      case 5:
        return this.lang.t('assemble.attack_succ_inform_5', phpString(attackName));
      case 10:
        return this.lang.t('assemble.attack_succ_inform_10', phpString(attackName));
      case 15:
        return this.lang.t('assemble.attack_succ_inform_15', phpString(attackName));
      case 30:
        return this.lang.t('assemble.attack_succ_inform_30', phpString(attackName));
      default:
        return '';
    }
  }

  /** A player-side hero slice for startUserPK; `force` is a MySQL 8 reserved word. */
  private async playerHeroPart(hid: number, standIndex: number): Promise<PkHeroEntry> {
    return (
      (await this.row(
        sql<Row>`select a.hid, a.sex, \`force\` as energy, ${standIndex} as standIndex,
          command_base + command_add_on as command, affairs_base + affairs_add + affairs_add_on as affair,
          bravery_base + bravery_add + bravery_add_on as bravery,
          wisdom_base + wisdom_add + wisdom_add_on as wisdom, speed_add_on as speed
        from sys_city_hero a, mem_hero_blood b where a.hid = b.hid and a.hid = ${hid}`,
      )) ?? false
    );
  }

  /** A cfg_pk_hero hero slice for NPC defenders. */
  private async npcHeroPart(hid: number, standIndex: number): Promise<PkHeroEntry> {
    return (
      (await this.row(
        sql<Row>`select hid, sex, energy + energy_add as energy, ${standIndex} as standIndex,
          command_base + command_add as command, affair_base + affair_add as affair,
          bravery_base + bravery_add as bravery, wisdom_base + wisdom_add as wisdom,
          speed_base + speed_add as speed
        from cfg_pk_hero where hid = ${hid}`,
      )) ?? false
    );
  }

  /** `select h.*,b.*` — the full joined row; `uid` filters only when given (loadUserBattleHero). */
  private async fullHeroRow(hid: unknown, uid: number | undefined): Promise<Row | false> {
    const uidClause = uid === undefined ? sql<Row>`` : sql<Row>` and h.uid = ${uid}`;
    return (
      (await this.row(
        sql<Row>`select h.*, b.* from sys_city_hero h, mem_hero_blood b
          where h.hid = b.hid and h.hid = ${phpIntval(hid)}${uidClause}`,
      )) ?? false
    );
  }

  /** `select *,FLOOR(...) as battle from cfg_pk_hero`. */
  private async npcFullHeroRow(hid: unknown): Promise<Row | false> {
    return (
      (await this.row(
        sql<Row>`select *, floor((bravery_base + bravery_add) * 5 + (energy + energy_add) * 10
          + wisdom_base + wisdom_add) as battle from cfg_pk_hero where hid = ${phpIntval(hid)}`,
      )) ?? false
    );
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  /** `sql_fetch_one_cell`: the first column, or `false` without rows. */
  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row === undefined ? false : Object.values(row)[0];
  }

  /** `sql_check`: whether any row answers. */
  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}

/** `select *,GREATEST(...) ... order by rank limit 10` / `limit ${start},10` (PKFunc.php:806-812). */
function rankWindow(startIndex: number | undefined): RawBuilder<Row> {
  return startIndex === undefined
    ? sql<Row>`select *, greatest(0, endtime - unix_timestamp()) as getRewardTime from mem_assemble
        order by \`rank\` limit 10`
    : sql<Row>`select *, greatest(0, endtime - unix_timestamp()) as getRewardTime from mem_assemble
        order by \`rank\` limit ${startIndex}, 10`;
}

/** PKFunc.php:1288 parseAndAddReward($uid, $rewardInfo, 619, 619, 619, 619). */
const ARENA_REWARD_LOG: RewardLogReasons = { goods: 619, armor: 619, things: 619, money: 619 };

/** A config row's field, or null when PHP would read it off `false`. */
function fieldOf(row: Row | false | undefined, key: string): unknown {
  return row && typeof row === 'object' ? row[key] : null;
}

/** A mem_assemble_hero hid as PHP interpolation would write it (0 for the NOT NULL default). */
function hidOf(config: Row, key: string): number {
  return phpIntval(config[key]);
}
