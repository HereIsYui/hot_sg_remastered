import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** HeroFunc.php::dogetReward: 五铢钱 gid and the per-10-levels reward tiers. */
const KING_REWARD_GID = 10960;
const KING_REWARD_LOG = 710;
/** `[maxHeroLevel, count]` tiers (inclusive upper bound), in the original's order. */
const KING_REWARD_TIERS: [number, number][] = [
  [9, 5],
  [19, 10],
  [29, 15],
  [39, 20],
  [49, 30],
  [59, 50],
  [69, 60],
  [79, 80],
  [89, 100],
  [99, 120],
  [109, 150],
  [125, 200],
];

/** cfg_soldier id threshold at which setSoldierTactics maps a sid to its soldier `type`. */
const SOLDIER_SID_BASE = 51;
/** sys_battle.type 4: 战场战 (battlefield). */
const BATTLE_TYPE_FIELD = 4;
/** mem_battle.type 5: 洛阳 battle (city names come from cfg_luoyang_city_add). */
const BATTLE_TYPE_LUOYANG = 5;

/**
 * TroopFunc.php battle readers (`BloodWar:Troop/BattleDialog`) and HeroFunc.php::getKingReward.
 *
 * The `sys_battle*` / `mem_battle*` tables are written by the parallel battle-engine wave exactly
 * as the PHP engine wrote them; this module READS them the way PHP's TroopFunc did. The one write
 * here, setSoldierTactics, only touches `mem_battle_tactics` (the player's own orders), as the
 * original did. No scope.transaction() wraps a write that ends in a success message (lesson).
 */
@Injectable()
export class BattleReadCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
  ) {}

  private get db() {
    return this.scope.db;
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  /**
   * TroopFunc.php::getBattleReport: the rounds of a battle after `lastround`, plus the battle's
   * `sys_battle` / `mem_battle` state and both sides' `mem_battle_tactics`. Shape:
   * `[sysbattle, membattle, reportRows, attackTactics, resistTactics]`.
   */
  @GlobalCommand()
  async getBattleReport(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const battleid = phpIntval(param[0]);
    const lastround = phpIntval(param[1]);
    const report = await this.rows(sql<Row>`select * from sys_battle_report
      where battleid = ${battleid} and round > ${lastround} order by round`);
    const sysbattle = await this.one(
      sql<Row>`select state, result from sys_battle where id = ${battleid}`,
    );
    const membattle = await this.one(sql<Row>`select * from mem_battle where id = ${battleid}`);
    return [
      sysbattle,
      membattle,
      report,
      await this.rows(
        sql<Row>`select * from mem_battle_tactics where battleid = ${battleid} and attack = 1`,
      ),
      await this.rows(
        sql<Row>`select * from mem_battle_tactics where battleid = ${battleid} and attack = 0`,
      ),
    ];
  }

  /**
   * TroopFunc.php::getBattleData: the full participant snapshot the BattleDialog opens on — type,
   * both sides' uid / name, city and hero rows — plus the first batch of rounds via
   * getBattleReport. A finished battle (`sys_battle.state == 1`) throws `battle_end`; missing
   * `sys_battle` / `mem_battle` throws `battle_data_lost`.
   */
  @GlobalCommand()
  async getBattleData(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const battleid = phpIntval(param[0]);
    const sysbattle = await this.one(sql<Row>`select * from sys_battle where id = ${battleid}`);
    if (sysbattle && phpIntval(sysbattle.state) === 1) {
      throw GameError.lang('getBattleData.battle_end');
    }
    const membattle = await this.one(sql<Row>`select * from mem_battle where id = ${battleid}`);
    if (sysbattle === false || membattle === false) {
      throw GameError.lang('getBattleData.battle_data_lost');
    }

    const ret: unknown[] = [];
    ret.push(sysbattle.type);
    const attackuid = phpIntval(sysbattle.attackuid);
    const resistuid = phpIntval(sysbattle.resistuid);
    const attackcid = phpIntval(membattle.attackcid);
    const resistcid = phpIntval(membattle.resistcid);
    const attackhid = phpIntval(membattle.attackhid);
    const resisthid = phpIntval(membattle.resisthid);
    const battleType = phpIntval(membattle.type);
    ret.push(attackuid);

    if (phpIntval(sysbattle.type) === BATTLE_TYPE_FIELD) {
      // 战场战.
      if (attackuid > 0) {
        ret.push(await this.one(sql<Row>`select uid, name from sys_user where uid = ${attackuid}`));
      }
      ret.push(resistuid);
      if (resistuid > 0) {
        ret.push(await this.one(sql<Row>`select uid, name from sys_user where uid = ${resistuid}`));
      } else {
        const battleunionid = phpIntval(
          await this.cell(sql<Row>`select battleunionid from sys_troops
            where battleid = ${battleid} and uid = 0`),
        );
        if (battleunionid >= 1000) {
          ret.push(
            await this.one(sql<Row>`select uid, name from sys_user where uid = ${battleunionid}`),
          );
        } else {
          ret.push(
            await this.one(
              sql<Row>`select name from cfg_battle_union where unionid = ${battleunionid}`,
            ),
          );
        }
      }
      ret.push(attackcid);
      if (attackcid > 0) {
        ret.push(await this.one(sql<Row>`select * from sys_battle_city where cid = ${attackcid}`));
      }
      ret.push(resistcid);
      if (resistcid > 0) {
        ret.push(await this.one(sql<Row>`select * from sys_battle_city where cid = ${resistcid}`));
      }
      ret.push(attackhid);
      if (attackhid > 0) {
        ret.push(await this.one(sql<Row>`select * from sys_city_hero where hid = ${attackhid}`));
      }
      ret.push(resisthid);
      if (resisthid) {
        if (resistuid > 0) {
          ret.push(await this.one(sql<Row>`select * from sys_city_hero where hid = ${resisthid}`));
        } else {
          ret.push(
            await this.one(sql<Row>`select * from cfg_battle_hero where hid = ${resisthid}`),
          );
        }
      }
    } else {
      if (attackuid > 0) {
        ret.push(await this.one(sql<Row>`select uid, name from sys_user where uid = ${attackuid}`));
      }
      ret.push(resistuid);
      if (resistuid > 0) {
        ret.push(await this.one(sql<Row>`select uid, name from sys_user where uid = ${resistuid}`));
      }
      ret.push(attackcid);
      if (attackcid > 0) {
        ret.push(await this.cityRow(battleType, attackcid));
      }
      ret.push(resistcid);
      if (resistcid > 0) {
        ret.push(await this.cityRow(battleType, resistcid));
      }
      // 原版此处注释掉了 $ret[] = $attackhid;，攻方英雄按取不到即回 -1 的方式单独追加。
      if (attackhid > 0) {
        const heroInfo = await this.one(
          sql<Row>`select * from sys_city_hero where hid = ${attackhid}`,
        );
        if (heroInfo === false) {
          ret.push(-1);
        } else {
          ret.push(attackhid);
          ret.push(heroInfo);
        }
      } else {
        ret.push(attackhid);
      }
      ret.push(resisthid);
      if (resisthid) {
        ret.push(await this.one(sql<Row>`select * from sys_city_hero where hid = ${resisthid}`));
      }
    }

    ret.push(await this.getBattleReport(ctx, [battleid, 0]));
    return ret;
  }

  /** The battle participant city row: 洛阳 battles read cfg_luoyang_city_add, others sys_city. */
  private async cityRow(battleType: number, cid: number): Promise<Row | false> {
    if (battleType === BATTLE_TYPE_LUOYANG) {
      return this.one(sql<Row>`select cid, name from cfg_luoyang_city_add where cid = ${cid}`);
    }
    return this.one(sql<Row>`select * from sys_city where cid = ${cid}`);
  }

  /**
   * TroopFunc.php::setSoldierTactics: record the player's per-soldier-type order for a battle. A
   * sid ≥ 51 is mapped to its soldier `type`. Only the attack/resist player the battle belongs to
   * may set their own side (`cant_change_enemy_tactics`). Before the wall falls (`wallhp > 0`) the
   * row only updates action/target; after it falls a full `replace` keeps action2/target2 too.
   * The original wrapped nothing in a transaction and returned nothing; neither do we (lesson).
   */
  @GlobalCommand()
  async setSoldierTactics(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const p = [...param];
    const battleid = phpIntval(p.shift());
    const userIsAttack = p.shift();
    const stype = phpIntval(p.shift());
    const action = phpIntval(p.shift());
    let target = phpIntval(p.shift());

    if (target >= SOLDIER_SID_BASE) {
      target = phpIntval(
        await this.cell(sql<Row>`select type from cfg_soldier where sid = ${target}`),
      );
    }

    const isAttack = Boolean(userIsAttack);
    const attack = isAttack ? 1 : 0;
    const sysbattle = await this.one(sql<Row>`select * from sys_battle where id = ${battleid}`);
    if (
      (isAttack && ctx.uid !== phpIntval((sysbattle as Row).attackuid)) ||
      (!isAttack && ctx.uid !== phpIntval((sysbattle as Row).resistuid))
    ) {
      throw GameError.lang('setSoldierTactics.cant_change_enemy_tactics');
    }

    const wallhp = phpIntval(
      await this.cell(sql<Row>`select wallhp from mem_battle where id = ${battleid}`),
    );
    if (wallhp <= 0) {
      await sql`replace into mem_battle_tactics
        (\`battleid\`, \`attack\`, \`stype\`, \`action\`, \`target\`, \`action2\`, \`target2\`)
        values (${battleid}, ${attack}, ${stype}, ${action}, ${target}, ${action}, ${target})`.execute(
        this.db,
      );
    } else {
      await sql`update mem_battle_tactics set action = ${action}, target = ${target}
        where battleid = ${battleid} and attack = ${attack} and stype = ${stype}`.execute(this.db);
    }
    return [];
  }

  /**
   * HeroFunc.php::getKingReward (Report/KingRewardPanel): the daily 五铢钱 payout scaled by the
   * 君主将 level. Throws when there is no 君主将 (`not_find_kingHero`) or the reward was already
   * taken today (`has_get_reward`). No transaction wraps the write-then-success (lesson).
   */
  @GlobalCommand()
  async getKingReward(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    const kingInfo = await this.one(
      sql<Row>`select * from sys_city_hero where uid = ${uid} and herotype = '1000'`,
    );
    if (kingInfo === false) throw GameError.lang('king.not_find_kingHero');

    const levelRow = await this.one(
      sql<Row>`select * from sys_user_level where uid = ${uid} limit 1`,
    );
    if (levelRow === false) {
      await sql`insert into sys_user_level (\`uid\`, \`level\`, \`time\`, \`getrewardtime\`)
        values (${uid}, 0, 0, 0)`.execute(this.db);
    }

    const lastUpdate = await this.cell(
      sql<Row>`select substr(from_unixtime(getrewardtime), 1, 10) from sys_user_level
        where uid = ${uid}`,
    );
    const curDate = await this.cell(sql<Row>`select substr(now(), 1, 10)`);
    if (!phpEmpty(lastUpdate) && String(lastUpdate) === String(curDate)) {
      throw GameError.lang('king.has_get_reward');
    }

    const heroLevel = phpIntval(kingInfo.level);
    const tier = KING_REWARD_TIERS.find(([max]) => heroLevel <= max);
    const count = tier ? tier[1] : 0;
    if (count > 0) {
      await this.goods.addGoods(uid, KING_REWARD_GID, count, KING_REWARD_LOG);
    }
    await sql`update sys_user_level set \`getrewardtime\` = unix_timestamp()
      where uid = ${uid}`.execute(this.db);

    return [this.lang.t('king.get_reward_succ', count)];
  }
}
