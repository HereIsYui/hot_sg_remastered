import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { DialogCommand, GlobalCommand, type CommandContext } from '../gateway/decorators';
import { GAME_SPEED_RATE } from './technic-rules.service';

type Row = Record<string, unknown>;

/** 铜钱 item gid (StoreFunc.php uses 152 for the pack fee). */
const GID_COPPER = 152;

/** The four resource rates `modifyStoreRate` writes, in food/wood/rock/iron order. */
type Rate = 'food' | 'wood' | 'rock' | 'iron';

/** payToPack: the item type sent by the client -> the gid it hands back packed. */
const PACK_TYPE_TO_GID: Record<string, number> = {
  gold1: 86,
  gold2: 85,
  food1: 91,
  food2: 87,
  iron1: 94,
  iron2: 90,
  rock1: 93,
  rock2: 89,
  wood1: 92,
  wood2: 88,
};

/** payToPack: the item type -> the mem_city_resource column it spends. */
const PACK_TYPE_TO_COL: Record<string, Rate | 'gold'> = {
  gold1: 'gold',
  gold2: 'gold',
  food1: 'food',
  food2: 'food',
  iron1: 'iron',
  iron2: 'iron',
  rock1: 'rock',
  rock2: 'rock',
  wood1: 'wood',
  wood2: 'wood',
};

/** 洗练 gids the barn dialog cycles through (loadBarnGoods). */
const XILIAN_GIDS = [12079, 12080, 12081];

/**
 * StoreFunc.php (仓库, bid 17) and BarnFunc.php (粮仓/马厩, bid 16). Store owns the resource-split
 * dialog (`doGetStoreInfo`, `modifyStoreRate`, `payToPack`); Barn owns the item lists the 坐骑
 * command dialog loads (`loadBarnGoods`, `loadZuojiArmor`) and the unembed of a zuoji hole
 * (`doUnlade`). The barn's 强化/镶嵌/激活/升级 live with the blacksmith commands.
 */
@Injectable()
export class StoreBarnCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
  ) {}

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    if (!row) return false;
    return Object.values(row)[0];
  }

  /**
   * BuildingFunc.php::doGetStoreInfo — what the 仓库 dialog shows: the four resource bases, the
   * 仓储 technic multiplier (tid 15), the 粮仓 count and total extra capacity, the saved split
   * ratios and the player's 铜钱. Called by getBuildingInfo for bid 17, not an openfunc command.
   */
  async storeInfo(uid: number, cid: number): Promise<unknown[]> {
    const base = async (bid: number) =>
      phpNum(
        await this.cell(sql<Row>`select sum(level*(level+1)*50) as v
          from sys_building where cid = ${cid} and bid = ${bid}`),
      ) *
      100 *
      GAME_SPEED_RATE;
    const foodbase = await base(1);
    const woodbase = await base(2);
    const rockbase = await base(3);
    const ironbase = await base(4);

    let storageTechLevel = phpNum(
      await this.cell(sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = 15`),
    );
    if (phpEmpty(storageTechLevel)) storageTechLevel = 1;
    else if (storageTechLevel > 0) storageTechLevel = 1.0 + 0.1 * storageTechLevel;

    const barnCount = await this.cell(
      sql<Row>`select count(*) as v from sys_building where cid = ${cid} and bid = 17`,
    );
    const barnStore =
      GAME_SPEED_RATE *
      phpNum(
        await this.cell(sql<Row>`select sum(level*(level+1)*5000) as v
          from sys_building where cid = ${cid} and bid = 17`),
      );
    const resAdd = await this.one(sql<Row>`select food_store, wood_store, rock_store, iron_store
      from sys_city_res_add where cid = ${cid}`);
    const copper = await this.cell(
      sql<Row>`select count from sys_goods where gid = ${GID_COPPER} and uid = ${uid}`,
    );

    return [
      foodbase,
      woodbase,
      rockbase,
      ironbase,
      storageTechLevel,
      barnCount,
      barnStore,
      resAdd,
      copper,
    ];
  }

  /**
   * `[foodRate, woodRate, rockRate, ironRate]`: saves the resource storage split (0-100 each,
   * sum ≤ 100) and flags the city for a resource recompute. Always ends by throwing the success
   * message, as the original did.
   */
  @DialogCommand()
  async modifyStoreRate(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { cid } = ctx;
    const foodrate = phpIntval(param[0]);
    const woodrate = phpIntval(param[1]);
    const rockrate = phpIntval(param[2]);
    const ironrate = phpIntval(param[3]);
    if (foodrate < 0 || woodrate < 0 || rockrate < 0 || ironrate < 0) {
      throw GameError.lang('modifyStoreRate.negative_store_rate');
    } else if (foodrate + woodrate + rockrate + ironrate > 100) {
      throw GameError.lang('modifyStoreRate.resource_total_100');
    }
    await sql`update sys_city_res_add set food_store = ${foodrate}, wood_store = ${woodrate},
      rock_store = ${rockrate}, iron_store = ${ironrate}, resource_changing = 1
      where cid = ${cid}`.execute(this.scope.db);
    throw GameError.lang('modifyStoreRate.succ_change_rate');
  }

  /**
   * `[ [type, packCount, resNeed, copperNeed], ... ]`: packs city resources into tradable goods,
   * paying 铜钱 per pack. Validates every entry first (enough resource, enough 铜钱), then spends
   * and grants. Answers `[0, 0]`.
   */
  @DialogCommand()
  async payToPack(ctx: CommandContext, param: unknown[]): Promise<unknown[] | undefined> {
    const { uid, cid } = ctx;
    if (phpEmpty(uid) || phpEmpty(cid) || phpEmpty(param)) return undefined;
    const entries = param as unknown[][];

    // Resolve + validate each entry's type up front (original would hit a bad SQL column instead).
    const packs = entries.map((arr) => {
      const type = phpString(arr[0]);
      const gid = PACK_TYPE_TO_GID[type];
      const col = PACK_TYPE_TO_COL[type];
      if (gid === undefined || col === undefined) throw GameError.lang('payToPack.res_type_error');
      return { gid, col, arr };
    });

    // Check pass: every resource column has enough, and the 铜钱 total is affordable.
    let totalCopper = 0;
    for (const { col, arr } of packs) {
      const resource = phpNum(
        await this.cell(sql<Row>`select ${sql.ref(col)} from mem_city_resource where cid = ${cid}`),
      );
      if (resource < phpNum(arr[2])) throw GameError.lang('payToPack.not_enough_res');
      totalCopper += phpNum(arr[3]);
    }
    totalCopper = Math.ceil(totalCopper);
    const curCopper = phpNum(
      await this.cell(
        sql<Row>`select count from sys_goods where uid = ${uid} and gid = ${GID_COPPER}`,
      ),
    );
    if (curCopper < totalCopper) throw GameError.lang('payToPack.not_enough_moeny');

    // Pay and deliver.
    for (const { gid, col, arr } of packs) {
      await this.goods.addGoods(uid, GID_COPPER, -Math.ceil(phpNum(arr[3])), 2);
      await this.goods.addGoods(uid, gid, Math.floor(phpNum(arr[1])), 2);
      const spend = -phpNum(arr[2]);
      // addCityResources(cid, wood, rock, iron, food, gold)
      if (col === 'wood') await this.cityRules.addCityResources(cid, spend, 0, 0, 0, 0);
      else if (col === 'rock') await this.cityRules.addCityResources(cid, 0, spend, 0, 0, 0);
      else if (col === 'iron') await this.cityRules.addCityResources(cid, 0, 0, spend, 0, 0);
      else if (col === 'food') await this.cityRules.addCityResources(cid, 0, 0, 0, spend, 0);
      else if (col === 'gold') await this.cityRules.addCityResources(cid, 0, 0, 0, 0, spend);
    }
    return [0, 0];
  }

  /**
   * `[xilianIndex]`: the item counts the 坐骑 command dialog shows — strengthen/embed stones, the
   * chosen 洗练 stone, and the four 升级 materials. Answers one rows array.
   */
  @GlobalCommand()
  async loadBarnGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const xilianIndex = phpIntval(param[0]);
    if (xilianIndex > 2 || xilianIndex < 0) throw GameError.lang('xilian.param_error');
    const xilianGid = XILIAN_GIDS[xilianIndex]!;
    const rows = await this.rows(sql<Row>`select b.*,
      (select count from sys_goods where uid = ${uid} and gid = b.gid) as count
      from cfg_goods b
      where b.gid in (212, 213, 214, 11171, ${xilianGid}, 12157, 12158, 12159, 12160, 12161)`);
    return [rows];
  }

  /**
   * `[zuojiType, armorId]`: the player's zuoji goods of one 坐骑装备 type (owned, count > 0), for
   * the embed picker. Answers one rows array.
   */
  @GlobalCommand()
  async loadZuojiArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const zuojiType = phpIntval(param[0]);
    const rows = await this.rows(sql<Row>`select g.*, f.*
      from sys_goods g left join cfg_goods f on f.gid = g.gid
      where g.uid = ${uid} and f.zuoji_type = ${zuojiType} and g.count > 0`);
    return [rows];
  }

  /**
   * `[sid, gid, pos]`: pulls one embedded 坐骑 pearl out of hole `pos` and returns it to the bag.
   * Answers `[0, pos, newPearls]`.
   */
  @GlobalCommand()
  async doUnlade(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const sid = phpIntval(param[0]);
    const gid = phpIntval(param[1]);
    const pos = phpIntval(param[2]);
    if (pos < 0 || pos > 4) throw GameError.lang('equipment.invalid_pos');
    if (!this.isFitPos(gid, pos)) throw GameError.lang('equipment.invalid_pos');

    const armor = await this.one(
      sql<Row>`select * from sys_user_armor where uid = ${uid} and sid = ${sid}`,
    );
    if (!armor) throw GameError.lang('equipment.no_such_armor');

    const ary = phpString(armor.embed_pearls).split(',');
    if (phpIntval(ary[pos]) !== gid) throw GameError.lang('waigua.invalid');

    ary[pos] = '0';
    const pearls = ary.map((v) => (v === '' ? '0' : v)).join(',');
    await sql`update sys_user_armor set embed_pearls = ${pearls}
      where sid = ${sid} and uid = ${uid}`.execute(this.scope.db);
    await this.goods.addGoods(uid, gid, 1, 0);

    return [0, pos, pearls];
  }

  /** BarnFunc.php::isFitPos — which hole a zuoji/armor pearl gid belongs in. */
  private isFitPos(gid: number, pos: number): boolean {
    if (gid >= 502 && gid <= 582) return pos === phpIntval(phpIntval(gid - 400) / 20) - 5;
    if (gid >= 1400 && gid <= 1500) return pos === phpIntval(phpIntval(gid - 1400) / 20);
    if (gid >= 12178 && gid <= 12182) return pos === phpIntval(gid - 12178);
    return pos === phpIntval(phpIntval(gid - 400) / 20);
  }
}
