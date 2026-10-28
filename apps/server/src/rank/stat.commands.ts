import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { LangService } from '../common/lang.service';
import { phpEmpty, phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** StatFunc.php:8 EVENT — the stats dialog's five tabs, dispatched by getStats's type. */

/** StatFunc.php:190 getPos: a city id renders as "(x,y)". */
function pos(cid: number): string {
  return `(${cid % 1000},${Math.floor(cid / 1000)})`;
}

/** StatFunc.php:137-166: the pinyin field keys the client's 统计 grid expects. */
const SOLDIER_KEYS: Record<number, string> = {
  1: 'minfu',
  2: 'yibing',
  3: 'chihou',
  4: 'changqiang',
  5: 'daodun',
  6: 'gongjian',
  7: 'qingqi',
  8: 'tieqi',
  9: 'zizhong',
  10: 'chuangnu',
  11: 'chongche',
  12: 'toushi',
  45: 'bing45',
  46: 'bing46',
  47: 'bing47',
  48: 'bing48',
  49: 'bing49',
  50: 'bing50',
};

/** StatFunc.php:172: the defence field keys. */
const DEFENCE_KEYS: Record<number, string> = {
  1: 'xianjing',
  2: 'juma',
  3: 'jianta',
  4: 'gunmu',
  5: 'leishi',
};

/**
 * StatFunc.php: the 幕僚 statistics dialog's five read-only tabs (0 城池, 1 资源, 2 产量,
 * 3 将领, 4 军队, 5 城防), dispatched by getStats's type argument. Every tab returns
 * `[ [], <tag>, ...rows ]` with each row's cid rendered as "(x,y)".
 */
@Injectable()
export class StatCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
  ) {}

  @GlobalCommand()
  async getStats(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    switch (phpIntval(param[0])) {
      case 0:
        return this.cityStats(ctx.uid);
      case 1:
        return this.resourceStats(ctx.uid);
      case 2:
        return this.productStats(ctx.uid);
      case 3:
        return this.heroStats(ctx.uid);
      case 4:
        return this.armyStats(ctx.uid);
      case 5:
        return this.defenceStats(ctx.uid);
      default:
        return 'error';
    }
  }

  /** StatFunc.php:20-67: the cities with their upgrade/draft/defence queue counts. */
  private async cityStats(uid: number): Promise<unknown[]> {
    const citys = await this.rows(sql<Row>`select c.cid, c.name, r.people, r.morale, r.complaint,
      r.tax from sys_city c left join mem_city_resource r on c.cid = r.cid where uid = ${uid}`);
    const allCitys: Record<number, Row> = {};
    for (const city of citys) allCitys[phpIntval(city.cid)] = city;
    const condition = citys.map((c) => phpIntval(c.cid));
    const ids = condition.length ? condition : [-1];
    const counts = await this.rows(sql<Row>`select cid, count(*) as cnt from sys_building
      where cid in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) and state > 0 group by cid`);
    for (const row of counts) {
      const city = allCitys[phpIntval(row.cid)];
      if (city) city.buildingCount = row.cnt;
    }
    const tec = await this.rows(sql<Row>`select cid, count(*) as cnt from mem_technic_upgrading
      where cid in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) group by cid`);
    for (const row of tec) {
      const city = allCitys[phpIntval(row.cid)];
      if (city) city.tecCount = row.cnt;
    }
    const draft = await this.rows(sql<Row>`select cid, count(*) as cnt from mem_city_draft
      where cid in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) group by cid`);
    for (const row of draft) {
      const city = allCitys[phpIntval(row.cid)];
      if (city) city.draftCount = row.cnt;
    }
    const defence = await this.rows(sql<Row>`select cid, count(*) as cnt from mem_city_reinforce
      where cid in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) group by cid`);
    for (const row of defence) {
      const city = allCitys[phpIntval(row.cid)];
      if (city) city.defenceCount = row.cnt;
    }
    const ret: unknown[] = [[], 0];
    for (const city of Object.values(allCitys)) {
      ret.push({ ...city, cid: pos(phpIntval(city.cid)) });
    }
    return ret;
  }

  /** StatFunc.php:69-80: the floored resource stocks. */
  private async resourceStats(uid: number): Promise<unknown[]> {
    const citys = await this.rows(sql<Row>`select r.cid, c.name, floor(r.gold) as gold,
      floor(r.food) as food, floor(r.wood) as wood, floor(r.rock) as rock, floor(r.iron) as iron
      from sys_city c left join mem_city_resource r on r.cid = c.cid where c.uid = ${uid}`);
    const ret: unknown[] = [[], 1];
    for (const city of citys) {
      ret.push({ ...city, cid: pos(phpIntval(city.cid)) });
    }
    return ret;
  }

  /** StatFunc.php:82-100: the production rates with the 书院 tax tech (tid 25) and hero fee. */
  private async productStats(uid: number): Promise<unknown[]> {
    const citys = await this.rows(sql<Row>`select r.cid, c.name,
      floor(r.people * r.tax * 0.01 * r.gold_rate * 0.01 * 1) as gold_add, r.hero_fee as hero_fee,
      floor(r.food_add - r.food_army_use) as food_add, floor(r.wood_add) as wood_add,
      floor(r.rock_add) as rock_add, floor(r.iron_add) as iron_add
      from sys_city c left join mem_city_resource r on r.cid = c.cid where c.uid = ${uid}`);
    const ret: unknown[] = [[], 2];
    for (const city of citys) {
      const cid = phpIntval(city.cid);
      const clevel = await this.cell(
        sql<Row>`select level as v from sys_city_technic where cid = ${cid} and tid = 25`,
      );
      if (!phpEmpty(clevel)) {
        city.gold_add = phpNum(city.gold_add) * (phpNum(clevel) * 0.05 + 1);
      }
      city.gold_add = Math.floor(phpNum(city.gold_add) - phpNum(city.hero_fee));
      ret.push({ ...city, cid: pos(cid) });
    }
    return ret;
  }

  /** StatFunc.php:101-134: the heroes with computed attributes and the state names. */
  private async heroStats(uid: number): Promise<unknown[]> {
    const citys = await this.rows(sql<Row>`select h.cid, c.name, h.name as hero, h.level,
        (h.command_base + h.level + h.command_add_on) as command,
        (h.affairs_base + h.affairs_add + h.affairs_add_on) as affairs,
        (h.bravery_base + h.bravery_add + h.bravery_add_on) as bravery,
        (h.wisdom_base + h.wisdom_add + h.wisdom_add_on) as wisdom, h.loyalty, h.state, h.herotype
      from sys_city_hero h left join sys_city c on (c.cid = h.cid and c.uid = h.uid)
      where h.uid = ${uid} order by h.cid`);
    const ret: unknown[] = [[], 3];
    for (const city of citys) {
      const state = phpIntval(city.state);
      city.state = this.lang.value<Record<string, unknown>>('heroState')?.[String(state)] ?? '';
      ret.push({ ...city, cid: pos(phpIntval(city.cid)) });
    }
    return ret;
  }

  /** StatFunc.php:136-165: the soldier counts keyed by the pinyin field names; ≥100k renders 万. */
  private async armyStats(uid: number): Promise<unknown[]> {
    const citys = await this.rows(sql<Row>`select c.name, c.cid, group_concat(s.sid) as sids,
      group_concat(s.count) as counts from sys_city c
      left join sys_city_soldier s on c.cid = s.cid where c.uid = ${uid} group by cid`);
    const ret: unknown[] = [[], 4];
    for (const city of citys) {
      const sids = String(city.sids ?? '').split(',');
      const counts = String(city.counts ?? '').split(',');
      for (let i = 0; i < sids.length && sids[0] !== ''; i++) {
        const key = SOLDIER_KEYS[phpIntval(sids[i]!)];
        if (!key) continue;
        const cnt = phpNum(counts[i]);
        city[`${key}Count`] =
          cnt > 100000 ? `${Math.floor(cnt / 10000)}${this.lang.t('sys.wan')}` : phpIntval(cnt);
      }
      // the original row keeps the raw group_concat columns; restore them for the diff
      const out: Row = { ...city };
      out['group_concat(s.sid)'] = city.sids;
      out['group_concat(s.count)'] = city.counts;
      delete out.sids;
      delete out.counts;
      ret.push({ ...out, cid: pos(phpIntval(city.cid)) });
    }
    return ret;
  }

  /** StatFunc.php:166-188: the defences and the free wall area. */
  private async defenceStats(uid: number): Promise<unknown[]> {
    const citys = await this.rows(sql<Row>`select c.name, c.cid, group_concat(s.did) as dids,
      group_concat(s.count) as counts, b.level as level from sys_city c
      left join sys_city_defence s on c.cid = s.cid
      left join sys_building b on c.cid = b.cid where c.uid = ${uid} and bid = 20 group by cid`);
    const ret: unknown[] = [[], 5];
    for (const city of citys) {
      const dids = String(city.dids ?? '').split(',');
      const counts = String(city.counts ?? '').split(',');
      let area = 0;
      for (let i = 0; i < dids.length && dids[0] !== ''; i++) {
        const did = phpIntval(dids[i]!);
        const key = DEFENCE_KEYS[did];
        if (!key) continue;
        const cnt = phpIntval(counts[i]);
        city[`${key}Count`] = cnt;
        area += did * cnt;
      }
      city.area = phpNum(city.level) * 10000 - area;
      const out: Row = { ...city };
      out['group_concat(s.did)'] = city.dids;
      out['group_concat(s.count)'] = city.counts;
      delete out.dids;
      delete out.counts;
      ret.push({ ...out, cid: pos(phpIntval(city.cid)) });
    }
    return ret;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row ? Object.values(row)[0] : undefined;
  }
}
