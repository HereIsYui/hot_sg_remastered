import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** 坐骑 part id; the smithy refuses mounts (驯马 is a separate 马厩 flow). */
const PART_HORSE = 12;
/** 强化宝珠 / 高级强化宝珠 (level 0-9 / 10-15). */
const GOODS_STRONG_PEARL = 205;
const GOODS_HIGH_STRONG_PEARL = 11170;
/** 天工符 / 乾坤宝珠 — the two optional strengthening aids. */
const GOODS_TIANGONG = 203;
const GOODS_QIANKUN = 204;
/** 伯乐符 / 师皇针 (the horse branch's aliases, refused by the smithy). */
const GOODS_BOLE = 212;
const GOODS_SHIHUANG = 213;
/** 巧手符 / 宝珠保护符 for 合成. */
const GOODS_QIAOSHOU = 202;
const GOODS_PEARL_PROTECT = 11172;
/** 技能保护符 for 技能书合并. */
const GOODS_SKILL_PROTECT = 10667;
/** log_user_action of a 装备强化. */
const ACTION_STRONG = 15;
/** log_user_action of a 材料合成. */
const ACTION_SYNTH = 23;
/** log_user_action of a 开孔. */
const ACTION_OPEN_HOLE = 14;
/** addGoods / reduceGoods reason of a 合成. */
const LOG_SYNTH = 99;
/** addGoods reason of a 镶嵌. */
const LOG_EMBED = 13;
/** The banner colour of a strengthening announcement. */
const INFORM_COLOR = 49151;
/** cfg_act id of the strengthening event. */
const ACT_STRONG = 4422;

/**
 * EquipmentFunc.php — the 铁匠铺 (blacksmith): 强化 (strengthen), 镶嵌 (embed), 合成 (synthesize
 * materials), plus the 技能书合并 tab shared from HeroSkillFunc.php. The 坐骑 (mount) branch of
 * every function is **not ported** (it belongs to the 马厩 flow another agent owns): the smithy
 * always sends `is_zuoji = 0`, so a mount throws `equipment.data_exception` just as in the
 * original. 洗练 / 熔炼 / 装备升级 are separate subsystems and are not ported here either.
 */
@Injectable()
export class BlackSmithCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly users: UserRules,
    private readonly tasks: TaskRules,
    private readonly random: RandomService,
  ) {}

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  /** The player owns at least `need` of a good (defaults to one). */
  private async goodsCount(uid: number, gid: number): Promise<number> {
    const count = await this.cell(
      sql`select count from sys_goods where gid = ${gid} and uid = ${uid}`,
    );
    return phpEmpty(count) ? 0 : phpNum(count);
  }

  // ------------------------------------------------------------------ load

  /**
   * `[step, xilianIndex]`: the aid goods shown in every tab, plus (step < 0) the full pearl
   * list for the 合成 tab. The original passed a 洗练 index too; that tab is not ported, so it
   * is read and ignored here.
   */
  @GlobalCommand()
  async loadEquitmentInfor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const step = phpIntval(param[0]);
    const ret: unknown[] = [0];
    ret.push(
      await this.rows(sql`select *, (select count from sys_goods where uid = ${uid} and gid = b.gid)
        as count from cfg_goods b where b.gid in (202, 203, 204, 205, 11170, 11172, 10667, 10778,
        12157, 12158, 12159, 12160, 12161)`),
    );
    if (step < 0) {
      ret.push(
        await this
          .rows(sql`select *, (select count from sys_goods where uid = ${uid} and gid = a.gid)
          as count from cfg_goods a where ((a.gid >= 300 and a.gid <= 379) or a.gid = 205)
          and \`group\` = 4 order by a.gid`),
      );
    }
    return ret;
  }

  // ---------------------------------------------------------------- 强化

  /** EquipmentFunc.php::strongLimit: the strengthening caps by colour and 打造技巧. */
  private async strongLimit(armor: Row, cid: number): Promise<void> {
    const type = phpIntval(armor.type);
    const strongLevel = phpIntval(armor.strong_level);
    if (strongLevel >= 15) throw GameError.lang('equipment.strong_level_limit');
    // 坐骑 would use 驯马技巧 (tid 22); the smithy only handles gear, so 打造技巧 (tid 21).
    const tid = 21;
    const info = 'equipment.strong_limit_technic_blacksmith';
    const limitByTechnic = await this.cell(sql`select level from sys_city_technic
      where cid = ${cid} and tid = ${tid}`);
    const technic = phpEmpty(limitByTechnic) ? 0 : phpNum(limitByTechnic);
    if (strongLevel <= 9) {
      if (phpEmpty(limitByTechnic) || strongLevel >= technic) {
        throw GameError.lang(info, strongLevel + 1);
      }
    }
    if (strongLevel >= 10) {
      if (phpEmpty(limitByTechnic) || technic < 10) throw GameError.lang(info, 10);
    }
    if (
      (type === 1 && strongLevel >= 3) ||
      (type === 2 && strongLevel >= 6) ||
      (type === 3 && strongLevel >= 9)
    ) {
      const colours = this.lang.value<Record<string, string>>('battle')?.['strong_limit_array'] as
        Record<string, string> | undefined;
      throw GameError.lang('equipment.strong_limit', colours?.[String(type)] ?? type, strongLevel);
    }
    // 蓝装 strengthened to 11+ needs 熔炼 level 3 (mounts excepted, but mounts never reach here).
    if (type === 4 && strongLevel >= 10 && phpIntval(armor.combine_level) <= 2) {
      throw GameError.lang('equipment.blue_strong_limit');
    }
  }

  /**
   * `[cid, gid1, g1count, gid2, g2count, sid, (is_zuoji)]`: strengthen one piece. The client
   * never sends a mount, so this always runs the gear branch; a mount piece throws
   * `equipment.data_exception`. Answers like the original: `[0, msg]` when the piece vanished,
   * else `[1, result, strong_value, bestQuality]`.
   */
  @GlobalCommand()
  async doStrong(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const gid1 = phpIntval(param[1]);
    const good1Count = phpIntval(param[2]);
    const gid2 = phpIntval(param[3]);
    const good2Count = phpIntval(param[4]);
    const sid = phpIntval(param[5]);
    if (good1Count > 1 || good1Count < 0) throw GameError.lang('waigua.forbidden');
    if (good2Count > 1 || good2Count < 0) throw GameError.lang('waigua.forbidden');
    if (gid1 !== GOODS_BOLE && gid1 !== GOODS_TIANGONG)
      throw GameError.lang('equipment.wrong_item');
    if (gid2 !== GOODS_SHIHUANG && gid2 !== GOODS_QIANKUN) {
      throw GameError.lang('equipment.wrong_item');
    }
    // 坐骑 is not ported: the smithy dialog always sends gear, so is_zuoji is forced to 0.
    const isZuoji = 0;

    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const armor = await this.row(sql`select * from sys_user_armor s
        left join cfg_armor c on s.armorid = c.id where s.sid = ${sid} and s.uid = ${uid}`);
      if (!armor) return [0, this.msg('equipment.no_such_armor')];
      if (!phpLooseEquals(armor.hid, 0)) throw GameError.lang('equipment.armor_in_hero');
      if (phpLooseEquals(armor.part, PART_HORSE)) throw GameError.lang('equipment.data_exception');

      if (good1Count === 1 && (await this.goodsCount(uid, gid1)) <= 0) {
        throw GameError.raw(`not_enough_goods${GOODS_TIANGONG}`);
      }
      if (good2Count === 1 && (await this.goodsCount(uid, gid2)) <= 0) {
        throw GameError.raw(`not_enough_goods${GOODS_QIANKUN}`);
      }

      const startLevel = phpIntval(armor.strong_level);
      let strongValue = phpNum(armor.strong_value);
      const nlevel = startLevel + 1;

      // The strengthening pearl for the current level band.
      if (
        startLevel >= 0 &&
        startLevel <= 9 &&
        (await this.goodsCount(uid, GOODS_STRONG_PEARL)) <= 0
      ) {
        throw GameError.lang('equipment.no_strong_pearl');
      }
      if (
        startLevel >= 10 &&
        startLevel <= 15 &&
        (await this.goodsCount(uid, GOODS_HIGH_STRONG_PEARL)) <= 0
      ) {
        throw GameError.lang('equipment.no_high_strong_pearl');
      }

      await this.strongLimit(armor, cid);
      if (phpLooseEquals(armor.part, PART_HORSE)) throw GameError.lang('equipment.is_zuoji');

      const inAct = !phpEmpty(
        await this.cell(sql`select actid from cfg_act where actid = ${ACT_STRONG}
          and unix_timestamp() > starttime and unix_timestamp() < endtime limit 1`),
      );
      const next = await this.row(
        sql`select * from cfg_strong_probability where level = ${nlevel}`,
      );
      if (!next) throw GameError.lang('equipment.cannot_strong');

      let succAdd = good1Count * 7;
      if (inAct) succAdd += 3;

      const ret: unknown[] = [1];
      const sucVal = phpNum(next.suc_value) * (1 + succAdd / 100);
      let isSucc = this.random.rand() % 10000 < sucVal * 100;
      isSucc = await this.reCalculateSuccess(armor, inAct, isSucc);

      let bestQuality: string | null = phpString(armor.best_quality) || null;
      let endLevel = startLevel;

      if (isSucc) {
        if (!bestQuality) {
          bestQuality = await this.getBestQuality(phpNum(next.xilian_rate), phpIntval(armor.type));
        }
        if (bestQuality) {
          await sql`update sys_user_armor set strong_times = 0, strong_value = ${next.strong_value},
            strong_level = ${next.level}, best_quality = ${bestQuality}
            where uid = ${uid} and sid = ${sid}`.execute(db);
        } else {
          await sql`update sys_user_armor set strong_times = 0, strong_value = ${next.strong_value},
            strong_level = ${next.level} where uid = ${uid} and sid = ${sid}`.execute(db);
        }
        strongValue = phpNum(next.strong_value);
        endLevel = startLevel + 1;
        if (phpNum(next.level) >= 7) {
          const name = await this.cell(sql`select name from sys_user where uid = ${uid}`);
          const armorName = await this.cell(
            sql`select name from cfg_armor where id = ${armor.armorid}`,
          );
          await this.users.sendSysInform({
            type: 0,
            inuse: 1,
            starttime: 0,
            endtime: 60,
            interval: 0,
            scrollcount: 1,
            color: INFORM_COLOR,
            msg: this.msg('equipment.strong_7', name, armorName, next.level),
          });
        }
        ret.push(0);
        await this.tasks.completeTask(uid, 530);
        if (phpNum(next.level) === 6) await this.tasks.completeTaskWithTaskid(uid, 103803);
      } else {
        const zero = phpIntval(next.zero_value);
        const degrade = phpIntval(next.degrade_value);
        const intact = phpIntval(next.intact_value);
        const p = (this.random.rand() % 100) + 1;
        await sql`update sys_user_armor set strong_times = strong_times + 1
          where uid = ${uid} and sid = ${sid}`.execute(db);
        if (good2Count === 0) {
          if (p >= 1 && p <= zero) {
            await sql`update sys_user_armor set strong_value = 0, strong_level = 0
              where uid = ${uid} and sid = ${sid}`.execute(db);
            strongValue = 0;
            endLevel = 0;
            ret.push(1);
          } else if (p >= zero + 1 && p <= zero + degrade) {
            const before = phpIntval(next.level) - 2;
            const beforeInfo = await this.row(sql`select * from cfg_strong_probability
              where level = ${before}`);
            await sql`update sys_user_armor set strong_value = ${beforeInfo?.strong_value ?? 0},
              strong_level = ${beforeInfo?.level ?? 0} where uid = ${uid} and sid = ${sid}`.execute(
              db,
            );
            strongValue = phpNum(beforeInfo?.strong_value);
            endLevel = startLevel - 1;
            ret.push(2);
          } else if (p >= zero + degrade + 1 && p <= zero + degrade + intact) {
            ret.push(3);
            endLevel = startLevel;
          }
        } else {
          // 乾坤宝珠 / 师皇针 bought: the piece never drops, only stays intact.
          endLevel = startLevel;
          ret.push(3);
        }
      }

      if (good1Count === 1) await this.goods.addGoods(uid, gid1, -1, 0);
      if (good2Count === 1) await this.goods.addGoods(uid, gid2, -1, 0);
      if (startLevel <= 9) await this.goods.addGoods(uid, GOODS_STRONG_PEARL, -1, 0);
      else await this.goods.addGoods(uid, GOODS_HIGH_STRONG_PEARL, -1, 0);

      await this.users.logUserAction(uid, ACTION_STRONG);
      const useGoods = `${gid1},${good1Count},${gid2},${good2Count}`;
      await sql`insert into log_armor_strong values (${uid}, ${sid}, ${armor.armorid}, ${isZuoji},
        ${startLevel}, ${endLevel}, ${useGoods}, ${isSucc ? 1 : 0}, unix_timestamp())`.execute(db);

      ret.push(strongValue);
      ret.push(bestQuality);
      return ret;
    });
  }

  /** EquipmentFunc.php::reCalculateSuccess: a guaranteed success once the event's try cap is hit. */
  private async reCalculateSuccess(armor: Row, inAct: boolean, success: boolean): Promise<boolean> {
    if (!inAct) return success;
    const strongTimes = phpIntval(armor.strong_times);
    const level = phpIntval(armor.strong_level) + 1;
    const caps: Record<number, number> = {
      1: 1,
      2: 2,
      3: 3,
      4: 5,
      5: 7,
      6: 14,
      7: 20,
      8: 30,
      9: 40,
      10: 50,
      11: 5,
      12: 10,
      13: 15,
      14: 30,
      15: 50,
    };
    const maxTimes = caps[level] ?? 1000;
    return strongTimes >= maxTimes - 1 ? true : success;
  }

  /** EquipmentFunc.php::getBestQuality: a random 极品 (洗练) attribute at `rate`%, else null. */
  private async getBestQuality(rate: number, type: number): Promise<string | null> {
    if (this.random.mtRand(1, 100) > rate) return null;
    const sumRate = phpNum(await this.cell(sql`select count(1) from cfg_xilian`));
    if (sumRate <= 0) return null;
    const randId = this.random.mtRand(1, sumRate);
    const xilian = await this.row(sql`select * from cfg_xilian where id = ${randId}`);
    if (!xilian) return null;
    const propertyArr = phpString(xilian.property).split(',');
    const prop = this.pickProperty(propertyArr);
    const xilianType = await this.row(sql`select * from cfg_xilian_type where type = ${type}`);
    const value = this.random.mtRand(phpIntval(xilianType?.minAdd), phpIntval(xilianType?.maxAdd));
    const names = ['生命', '攻击', '防御', '射程', '速度', '负重'];
    return `${randId},${prop},${value},${phpString(xilian.name)},${names[prop] ?? ''}`;
  }

  /** EquipmentFunc.php::getProperty: weighted pick over the `prop,rate,prop,rate,...` list. */
  private pickProperty(propertyArr: string[]): number {
    let sumRate = 0;
    for (let i = 1; i < propertyArr.length; i += 2) sumRate += phpIntval(propertyArr[i]);
    if (sumRate <= 0) return 0;
    const rand = this.random.mtRand(1, sumRate);
    let acc = 0;
    for (let i = 1; i < propertyArr.length; i += 2) {
      acc += phpIntval(propertyArr[i]);
      if (rand <= acc) return phpIntval(propertyArr[i - 1]);
    }
    return 0;
  }

  // ---------------------------------------------------------------- 镶嵌

  /** `[val]`: the count of the 初级/高级打孔器; answers `[count]`. */
  @GlobalCommand()
  async onLoadDaKong(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const val = phpIntval(param[0]);
    const gid = val === 1 ? 206 : val === 2 ? 207 : 0;
    return [
      await this.cell(sql`select count from sys_goods where gid = ${gid} and uid = ${ctx.uid}`),
    ];
  }

  /** `[curPos]`: the player's embeddable pearls (聚魂珠 only in the last hole). */
  @GlobalCommand()
  async loadEmbedPearl(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const pos = phpIntval(param[0]);
    if (pos === 4) {
      return [
        await this.rows(sql`select * from sys_goods g left join cfg_goods f on f.gid = g.gid
          where g.uid = ${uid} and g.count > 0 and g.gid between 10830 and 10839`),
      ];
    }
    return [
      await this.rows(sql`select * from sys_goods g left join cfg_goods f on f.gid = g.gid
        where g.uid = ${uid} and g.count > 0
        and ((g.gid >= 300 and g.gid <= 379) or (g.gid >= 17500 and g.gid <= 17539))
        and f.\`group\` = 4 order by f.\`group\`, f.position`),
    ];
  }

  /** `[]`: the cfg pearl list with the player's counts, sorted for the 合成 tab. */
  @GlobalCommand()
  async loadEmbedPearl_OpenTab(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    const temp = await this.rows(sql`select *, (select count from sys_goods
      where uid = ${uid} and gid = a.gid) as count from cfg_goods a
      where ((a.gid >= 300 and a.gid <= 379) or a.gid = 205 or (a.gid >= 17500 and a.gid <= 17539))
      and \`group\` = 4 order by a.gid`);
    const slice = (start: number, len: number): Row[] => temp.slice(start, start + len);
    const sorted: Row[] = [
      ...slice(0, 1),
      ...slice(1, 10),
      ...slice(81, 5),
      ...slice(11, 10),
      ...slice(86, 5),
      ...slice(21, 10),
      ...slice(91, 5),
      ...slice(31, 10),
      ...slice(96, 5),
      ...slice(41, 10),
      ...slice(101, 5),
      ...slice(51, 10),
      ...slice(106, 5),
      ...slice(61, 10),
      ...slice(111, 5),
      ...slice(71, 10),
      ...slice(116, 5),
    ];
    return [sorted];
  }

  /** `[gidstr]`: the cfg_goods rows of the comma list (0 for an empty hole). */
  @GlobalCommand()
  async loadEmbedPearlByArmor(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const gids = phpString(param[0]).split(',');
    const out: unknown[] = [];
    for (const g of gids) {
      if (phpIntval(g) === 0) out.push(0);
      else
        out.push((await this.row(sql`select * from cfg_goods where gid = ${phpIntval(g)}`)) ?? 0);
    }
    return [out];
  }

  /** EquipmentFunc.php::parseHoleRule: an armor type's starting hole string. */
  private parseHoleRule(rule: string): string {
    return rule
      .split(',')
      .map((r) => {
        if (r === '0') return '1';
        if (r === 'N/A') return '3';
        if (r === '-1') return '2';
        if (r === '-2') return '4';
        return this.random.mtRand(1, phpIntval(r)) === 1 ? '0' : '1';
      })
      .join(',');
  }

  /** `[cid, sid]`: activate the holes of a piece for 黄金 (value×50); answers `[goldSpent]`. */
  @GlobalCommand()
  async initHoles(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const sid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const armor = await this.row(sql`select * from sys_user_armor a
        left join cfg_armor c on c.id = a.armorid where a.uid = ${uid} and a.sid = ${sid} limit 1`);
      if (!armor) throw GameError.lang('equipment.no_such_armor');
      const part = phpIntval(armor.part);
      if (!phpEmpty(armor.embed_holes) && phpString(armor.embed_holes) !== '') {
        throw GameError.lang(
          part !== PART_HORSE ? 'equipment.already_active' : 'equipment.already_active_horse',
        );
      }
      const res = await this.row(sql`select * from mem_city_resource where cid = ${cid}`);
      const reduceGold = (phpNum(armor.value) * 500) / 10;
      if (phpNum(res?.gold) < reduceGold) throw GameError.lang('equipment.not_enough_gold');

      let holes: string;
      const pearls = '0,0,0,0,0';
      if (part !== PART_HORSE) {
        const rule = await this.cell(
          sql`select rule from cfg_armor_hole_rule where type = ${armor.type}`,
        );
        holes = this.parseHoleRule(phpString(rule));
      } else {
        holes = '0,0,0,0,0';
      }
      await sql`update sys_user_armor set embed_holes = ${holes}, embed_pearls = ${pearls}
        where sid = ${sid}`.execute(db);
      await sql`update mem_city_resource set gold = gold - ${reduceGold}
        where cid = ${cid}`.execute(db);
      await this.users.logUserAction(uid, ACTION_OPEN_HOLE);
      await this.tasks.completeTaskWithTaskid(uid, 103802);
      return [reduceGold];
    });
  }

  /** EquipmentFunc.php::assembleEmbedHoles: replace one position, with the 聚魂珠 last-hole rule. */
  private assembleEmbedHoles(ary: string[], pos: number, value: number, isZuoji = 0): string {
    const out = [...ary];
    out[pos] = String(value);
    if (isZuoji !== 1 && value !== 0) {
      if (pos === 4) {
        if (value < 10830 || value > 10839) throw GameError.lang('goods.good_position_error');
      } else if (value >= 10830 && value <= 10839) {
        throw GameError.lang('goods.good_position_error');
      }
    }
    return out.map((v) => (v === '' ? '0' : v)).join(',');
  }

  /** `[sid, gid, pos, (useType, count)]`: open or clear a hole. Answers `[armor, pearlObjs, gid]`. */
  @GlobalCommand()
  async openHole(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const sid = phpIntval(param[0]);
    const gid = phpIntval(param[1]);
    const pos = phpIntval(param[2]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const armor = await this.row(sql`select * from sys_user_armor a
        left join cfg_armor c on c.id = a.armorid where a.uid = ${uid} and a.sid = ${sid} limit 1`);
      if (!armor) throw GameError.lang('equipment.no_such_armor');
      const ret: unknown[] = [];

      if (gid === 201 || gid === 12156) {
        // 化石粉 / 五彩化石粉: clear a pearl out of its hole.
        const pearlArr = phpString(armor.embed_pearls).split(',');
        const pearl = phpIntval(pearlArr[pos]);
        let needCount: number;
        let keep: boolean;
        if (gid === 201) {
          const full = this.dismantleCount(pearl);
          const useType = phpIntval(param[3]);
          const count = phpIntval(param[4]);
          if (
            (useType === 0 && count !== 1) ||
            (useType === 1 && count !== full) ||
            (useType !== 0 && useType !== 1)
          ) {
            throw GameError.lang('useGoods.invalid_data');
          }
          needCount = useType === 1 ? full : 1;
          keep = useType === 1;
        } else {
          const useType = phpIntval(param[3]);
          if (useType !== 0 && useType !== 1) throw GameError.lang('useGoods.invalid_data');
          needCount = 1;
          keep = useType === 1;
        }
        if ((await this.goodsCount(uid, gid)) < needCount) {
          const left = needCount - (await this.goodsCount(uid, gid));
          throw GameError.raw(`not_enough_goods${gid}#${left}`);
        }
        const str = this.assembleEmbedHoles(pearlArr, pos, 0);
        await sql`update sys_user_armor set embed_pearls = ${str}
          where uid = ${uid} and sid = ${sid}`.execute(db);
        if (keep && pearl !== 0) await this.goods.addGoods(uid, pearl, 1, 0);
        await this.goods.addGoods(uid, gid, -needCount, 0);
        armor.embed_pearls = str;
        ret.push(armor);
      } else {
        // 打孔器: open a locked hole.
        if ((await this.goodsCount(uid, gid)) <= 0) throw GameError.raw(`not_enough_goods${gid}`);
        const ary = phpString(armor.embed_holes).split(',');
        const str = this.assembleEmbedHoles(ary, pos, 0);
        await sql`update sys_user_armor set embed_holes = ${str}
          where uid = ${uid} and sid = ${sid}`.execute(db);
        await this.goods.addGoods(uid, gid, -1, 0);
        armor.embed_holes = str;
        ret.push(armor);
      }

      const objs: unknown[] = [];
      for (const g of phpString(armor.embed_pearls).split(',')) {
        if (phpIntval(g) === 0) objs.push(0);
        else
          objs.push(
            (await this.row(sql`select * from cfg_goods where gid = ${phpIntval(g)}`)) ?? 0,
          );
      }
      ret.push(objs, gid);
      return ret;
    });
  }

  /** EquipmentFunc.php::getDismantleCount: 化石粉 count to clear one pearl. */
  private dismantleCount(gid: number): number {
    if (gid >= 300 && gid <= 379) {
      const need = [1, 2, 3, 4, 6, 8, 10, 14, 20, 60];
      return need[(gid % 10) + 1 - 1] ?? 1;
    }
    if (gid >= 17500 && gid <= 17539) {
      const need = [120, 240, 500, 1000, 2000];
      return need[(gid % 5) + 11 - 11] ?? 1;
    }
    if (gid >= 10830 && gid <= 10839) {
      const need = [15, 30, 60, 120, 240, 500, 1000, 2000, 4000, 8000];
      return need[(gid % 10) + 1 - 1] ?? 1;
    }
    throw GameError.lang('dismantle.wrong_pearl_gid');
  }

  /** EquipmentFunc.php::embedLimit: a pearl's level cannot exceed the piece's 强化 level. */
  private embedLimit(armor: Row, gid: number): void {
    const strongLevel = phpIntval(armor.strong_level);
    if (gid >= 300 && gid <= 379) {
      const level = ((gid - 300) % 10) + 1;
      if (strongLevel < level) throw GameError.lang('equipment.embed_limit');
    }
    if (gid >= 17500 && gid <= 17539) {
      const level = (gid % 5) + 11;
      if (strongLevel < level) throw GameError.lang('equipment.embed_limit');
    }
    if (gid >= 10830 && gid <= 10839) {
      const level = ((gid - 10800) % 10) + 1;
      if (strongLevel < level) throw GameError.lang('equipment.embed_limit');
    }
  }

  /** `[sid, pos, gid]`: set a pearl in a hole. Answers `[1, 0, pearls, cfgRows]` (or `[0, msg]`). */
  @GlobalCommand()
  async doEmbed(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const sid = phpIntval(param[0]);
    const pos = phpIntval(param[1]);
    const gid = phpIntval(param[2]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const armor = await this.row(sql`select * from sys_user_armor s
        left join cfg_armor c on s.armorid = c.id where s.sid = ${sid} and s.uid = ${uid}`);
      if (!armor) return [0, this.msg('equipment.no_such_armor')];
      if (phpLooseEquals(armor.part, PART_HORSE)) throw GameError.lang('equipment.data_exception');
      if (phpEmpty(armor.embed_holes) || phpString(armor.embed_holes) === '') {
        throw GameError.lang('equipment.no_pos');
      }
      const holes = phpString(armor.embed_holes).split(',');
      if (phpIntval(holes[pos]) !== 0) throw GameError.lang('equipment.no_pos');
      if (!phpLooseEquals(armor.hid, 0)) throw GameError.lang('equipment.armor_in_hero');

      const goods = await this.row(
        sql`select * from sys_goods where uid = ${uid} and gid = ${gid}`,
      );
      this.embedLimit(armor, gid);
      if (!goods || phpNum(goods.count) <= 0) throw GameError.lang('equipment.no_embed_pearl');

      const oldPearls = phpString(armor.embed_pearls);
      const ary = oldPearls.split(',');
      if (phpIntval(ary[pos]) !== 0) throw GameError.lang('waigua.invalid');

      const pearls = this.assembleEmbedHoles(ary, pos, gid, 0);
      const ret: unknown[] = [1, 0];
      if (pearls !== oldPearls) {
        await sql`update sys_user_armor set embed_pearls = ${pearls}
          where sid = ${sid} and uid = ${uid}`.execute(db);
        await this.goods.addGoods(uid, gid, -1, LOG_EMBED);
        ret.push(pearls);
        // The original runs `gid in ($pearls)` with the raw hole string, so the 0s of the empty
        // holes pull in gid 0 (礼金) too; keep the zeros to match that row set and order.
        const gids = pearls.split(',').map(phpIntval);
        ret.push(await this.rows(sql`select * from cfg_goods where gid in (${sql.join(gids)})`));
        if (gid === 325) await this.tasks.completeTaskWithTaskid(uid, 103804);
      }
      return ret;
    });
  }

  // ---------------------------------------------------------------- 合成

  /** `[gid]`: the recipe materials for one pearl; answers `[gid, rows, recipe]`. */
  @GlobalCommand()
  async loadStuff(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const gid = phpIntval(param[0]);
    const ret: unknown[] = [gid];
    const baseGoods = [205, 300, 310, 320, 330, 340, 350, 360, 370];
    if (baseGoods.includes(gid)) {
      const recipe = phpString(
        await this.cell(sql`select recipe from cfg_recipe where gid = ${gid}`),
      );
      const tmp = recipe.split(',');
      const needGids: number[] = [];
      for (let i = 0; i < tmp.length; i += 2) needGids.push(phpIntval(tmp[i]));
      ret.push(
        needGids.length === 0
          ? []
          : await this.rows(sql`select *, (select count from sys_goods where uid = ${uid}
              and gid = a.gid) as count from cfg_goods a
              where a.gid in (${sql.join(needGids)}) order by a.gid`),
      );
      ret.push(recipe);
    } else {
      const elevenArr: Record<number, number> = {
        17500: 309,
        17505: 319,
        17510: 329,
        17515: 339,
        17520: 349,
        17525: 359,
        17530: 369,
        17535: 379,
      };
      const tmp = elevenArr[gid] ?? gid - 1;
      ret.push(
        await this.rows(sql`select *, (select count from sys_goods where uid = ${uid}
          and gid = a.gid) as count from cfg_goods a where a.gid in (${tmp}) and \`group\` = 4
          order by a.gid`),
      );
      ret.push(`${tmp},3`);
    }
    return ret;
  }

  /** EquipmentFunc.php::parseStuffRecipe: `gid,count,gid,count,...` into a map. */
  private parseStuffRecipe(recipe: string): Record<number, number> {
    const ary = recipe.split(',');
    const dict: Record<number, number> = {};
    for (let i = 0; i < ary.length; i += 2) dict[phpIntval(ary[i])] = phpIntval(ary[i + 1]);
    return dict;
  }

  /** EquipmentFunc.php::calculateProbability: random successes among `count` tries at `prop`%. */
  private calculateProbability(count: number, prop: number): number {
    let ret = 0;
    for (let i = 0; i < count; i++) if (this.random.mtRand(1, 10000) <= prop * 100) ret++;
    return ret;
  }

  /**
   * `[cid, targetGid, count, qiaoshou, pearlProtect]`: synthesize `count` materials into the
   * next tier. Answers `[synthCount, needGid, needPear]`.
   */
  @GlobalCommand()
  async synthStuff(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const targetGid = phpIntval(param[1]);
    const count = phpIntval(param[2]);
    if (count <= 0) throw GameError.lang('equipment.synth_count');
    const dj = phpIntval(param[3]);
    const pearlProtect = phpIntval(param[4]);
    let synthCount = count;

    return this.scope.transaction(async () => {
      if (dj === 1 && (await this.goodsCount(uid, GOODS_QIAOSHOU)) < count) {
        throw GameError.raw(`not_enough_goods${GOODS_QIAOSHOU}`);
      }
      if (pearlProtect === 1 && (await this.goodsCount(uid, GOODS_PEARL_PROTECT)) < count) {
        throw GameError.raw(`not_enough_goods${GOODS_PEARL_PROTECT}`);
      }
      const level1 = [300, 310, 320, 330, 340, 350, 360, 370];
      if (level1.includes(targetGid)) throw GameError.lang('equipment.linit_level1');

      // 镶嵌宝石 synthesis (gid != 205) rolls per-item; 强化宝珠 is deterministic.
      if (targetGid !== 205) {
        const limitByTechnic = await this.cell(sql`select level from sys_city_technic
          where cid = ${cid} and tid = 23`);
        const technic = phpEmpty(limitByTechnic) ? 0 : phpNum(limitByTechnic);
        let targetLevel = 0;
        if (targetGid >= 300 && targetGid <= 379) {
          targetLevel = (targetGid % 10) + 1;
          if (phpEmpty(limitByTechnic) || targetLevel > technic) {
            throw GameError.lang('equipment.sync_staff_limit_technic', targetLevel);
          }
        } else if (targetGid >= 17500 && targetGid <= 17539) {
          targetLevel = (targetGid % 5) + 11;
          if (phpEmpty(limitByTechnic) || technic < 10) {
            throw GameError.lang('equipment.sync_staff_limit_technic', 10);
          }
        }
        const rate = [80, 70, 60, 50, 40, 30, 20, 10, 10, 10, 10, 8, 5, 3, 1];
        let prop = rate[targetLevel - 1] ?? 0;
        if (targetGid >= 300 && targetGid <= 379 && dj === 1) {
          const limit = 19683 / Math.pow(3, targetLevel - 1);
          if (count <= limit) {
            // prop is effectively 100 here; synthCount is the full count.
            synthCount = count;
          } else {
            synthCount = limit + this.calculateProbability(count - limit, prop);
          }
        } else {
          const rateAdd = dj * 10;
          prop = prop * (1 + rateAdd / 100);
          synthCount = this.calculateProbability(count, prop);
        }
      }

      const recipe = phpString(
        await this.cell(sql`select recipe from cfg_recipe where gid = ${targetGid}`),
      );
      const tmpAry = recipe.split(',');
      const needGidParts: string[] = [];
      for (let i = 0; i < tmpAry.length; i += 2) needGidParts.push(phpString(tmpAry[i]));
      const needGid = needGidParts.join(', ');
      const dict = this.parseStuffRecipe(recipe);
      const needGids = Object.keys(dict).map((k) => phpIntval(k));
      const rows =
        needGids.length === 0
          ? []
          : await this.rows(sql`select * from sys_goods where uid = ${uid}
              and gid in (${sql.join(needGids)})`);
      if (rows.length === 0 || rows.length !== needGids.length)
        throw GameError.lang('equipment.no_stuff');
      for (const stuff of rows) {
        if (phpNum(stuff.count) < phpIntval(dict[phpIntval(stuff.gid)]) * count) {
          throw GameError.lang('equipment.no_stuff');
        }
      }

      await this.goods.addGoods(uid, targetGid, synthCount, LOG_SYNTH);
      let needPear = 0;
      for (const stuff of rows) {
        // With the 保护符, only the successful crafts consume materials.
        const multiplier = pearlProtect === 1 ? synthCount : count;
        needPear = phpIntval(dict[phpIntval(stuff.gid)]) * multiplier;
        await this.goods.addGoods(uid, phpIntval(stuff.gid), -needPear, LOG_SYNTH);
      }
      if (dj === 1) await this.goods.addGoods(uid, GOODS_QIAOSHOU, -count, 0);
      if (pearlProtect === 1) await this.goods.addGoods(uid, GOODS_PEARL_PROTECT, -count, 0);

      await this.users.logUserAction(uid, ACTION_SYNTH);
      return [synthCount, needGid, needPear];
    });
  }

  // ------------------------------------------------------- 技能书合并

  /** HeroSkillFunc.php::loadSkillBook_OpenTab: all books with the player's counts + 技能保护符. */
  private async skillBookTab(uid: number): Promise<unknown[]> {
    return [
      await this.rows(sql`select *, (select count(1) from sys_user_book where uid = ${uid}
        and bid = a.skill and level = a.level and hid = 0) as count from cfg_book a`),
      await this.row(sql`select c.*, g.count from cfg_goods c
        left join sys_goods g on g.gid = c.gid and g.uid = ${uid} where c.gid = ${GOODS_SKILL_PROTECT}`),
    ];
  }

  /** `[]`: open the 技能书 tab. */
  @GlobalCommand()
  async loadSkillBook_OpenTab(ctx: CommandContext): Promise<unknown[]> {
    return this.skillBookTab(ctx.uid);
  }

  /**
   * `[bid, level, flag]`: merge three same-skill books of `level` into one of `level+1`.
   * `flag` uses the 技能保护符 (material kept on failure). Answers `[success, flag, tab]`.
   */
  @GlobalCommand()
  async mergeBook(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const bid = phpIntval(param[0]);
    const level = phpIntval(param[1]);
    const flag = phpIntval(param[2]);
    if (level >= 10 || level <= 0) throw GameError.lang('book.skill_dev_incorrect');

    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const books = await this.rows(sql`select * from sys_user_book where uid = ${uid}
        and bid = ${bid} and level = ${level} and hid = 0 limit 3`);
      if (books.length !== 3) throw GameError.lang('book.not_your_book');
      if (flag && (await this.goodsCount(uid, GOODS_SKILL_PROTECT)) < 1) {
        throw GameError.raw(`not_enough_goods${GOODS_SKILL_PROTECT}`);
      }

      const nextLevel = level + 1;
      const rateCell = await this.cell(
        sql`select rate from cfg_book_rate where level = ${nextLevel}`,
      );
      const rate = phpEmpty(rateCell) ? 10 : phpNum(rateCell);
      const success = this.random.mtRand(1, 100) <= rate;
      const ids = books.map((b) => phpIntval(b.id));

      const ret: unknown[] = [];
      if (success) {
        await sql`insert into sys_user_book (bid, uid, hid, level)
          values (${bid}, ${uid}, 0, ${nextLevel})`.execute(db);
        await sql`delete from sys_user_book where id in (${sql.join(ids)})`.execute(db);
        await sql`insert into log_book (uid, bid, count, time, level)
          values (${uid}, ${bid}, -3, unix_timestamp(), ${level})`.execute(db);
        await sql`insert into log_book (uid, bid, count, time, level)
          values (${uid}, ${bid}, 1, unix_timestamp(), ${nextLevel})`.execute(db);
        if (flag === 1) {
          await this.goods.reduceGoods(uid, GOODS_SKILL_PROTECT, 1);
          await sql`insert into log_book_strong (uid, bid, startlevel, endlevel, usegoods, time, success)
            values (${uid}, ${bid}, ${level}, ${nextLevel}, ${GOODS_SKILL_PROTECT}, unix_timestamp(), 1)`.execute(
            db,
          );
        } else {
          await sql`insert into log_book_strong (uid, bid, startlevel, endlevel, usegoods, time, success)
            values (${uid}, ${bid}, ${level}, ${nextLevel}, 0, unix_timestamp(), 1)`.execute(db);
        }
        ret.push(1);
      } else {
        if (flag === 0) {
          await sql`delete from sys_user_book where id in (${sql.join(ids)})`.execute(db);
          await sql`insert into log_book (uid, bid, count, time, level)
            values (${uid}, ${bid}, -3, unix_timestamp(), ${level})`.execute(db);
          await sql`insert into log_book_strong (uid, bid, startlevel, endlevel, usegoods, time, success)
            values (${uid}, ${bid}, ${level}, ${nextLevel}, 0, unix_timestamp(), 0)`.execute(db);
        } else {
          await this.goods.reduceGoods(uid, GOODS_SKILL_PROTECT, 1);
          await sql`insert into log_book_strong (uid, bid, startlevel, endlevel, usegoods, time, success)
            values (${uid}, ${bid}, ${level}, ${nextLevel}, ${GOODS_SKILL_PROTECT}, unix_timestamp(), 0)`.execute(
            db,
          );
        }
        ret.push(0);
      }
      ret.push(flag);
      ret.push(await this.skillBookTab(uid));
      return ret;
    });
  }

  /** A lang string, matching PHP's sprintf-on-throw use for the inline `[0, msg]` replies. */
  private msg(key: string, ...args: unknown[]): string {
    return this.lang.t(key, ...args);
  }
}
