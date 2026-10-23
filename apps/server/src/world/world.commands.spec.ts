import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { MailService } from '../core/mail.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { WorldCommands } from './world.commands';

const lang = new LangService({
  addFavourites: {
    already_in_fav: '该目标已被收藏。 ',
    fav_is_full: '你的收藏目标已达到上限10个，删除其他目标后才能继续收藏。',
    succ: '收藏成功！你可以在校场的出征界面查看收藏列表。',
  },
  deleteFavourites: { error_in_del_fav: '删除收藏目标出错。' },
  setFavouritesComments: { already_exist: '收藏目标不存在。', succ: '修改目标备注成功。' },
  searchcityname: {
    enter_target_name: '请输入城池名称',
    union_name_tooLong: '城池名称最多8个字符！',
    target_union_not_exist: '该城池不存在',
  },
  addUnionRelation: {
    enter_target_name: '请输入对方联盟名字',
    union_name_tooLong: '联盟名称最多8个字符！',
    target_union_not_exist: '该联盟不存在！',
  },
  getUnionArea: { no_this_union: '这个联盟不存在。' },
  MarkCity: {
    No_Union: '你还没有联盟。',
    No_Permission: '你没有权限进行该项操作。',
    have_marked: '该城已被标记。',
    only_for_famous_city: '只能对名城标记。',
    not_in_war: '目标城池所属联盟并未与本盟开战。',
    too_many_marks: '标记城池的数量上限为20个…%s',
    mark_succ: '**标记成功',
    mark_mail_content: '本盟对城池%s（%s, %s）的占领开始。',
    mark_mail_title: '攻占城池',
  },
});

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };

const NOW = (ts: number): Respond => ({
  match: /select unix_timestamp\(\)/i,
  rows: [{ 'unix_timestamp()': ts }],
});
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const mail = { send: async () => {} } as unknown as MailService;
  const cmd = new WorldCommands(db.scope, lang, mail);
  return { cmd, db };
}

describe('WorldCommands.getBlockData', () => {
  it('returns the block concats plus the union marks', async () => {
    const { cmd } = build([
      // clearMark: no union, nothing to prune
      { match: /select union_id from sys_user/i, rows: [{ union_id: 7 }] },
      { match: /from sys_union_mark where unionid/i, rows: [{ id: 1, cid: 50, endtime: 9 }] },
      { match: /delete from sys_union_mark/i, rows: [] },
      {
        match: /group_concat/i,
        rows: [{ x: '0:1:0:0:3:1:1,5:2:0:0:5:1:1' }],
      },
    ]);
    const res = (await cmd.getBlockData(ctx, [[0]])) as unknown[];
    const blocks = res[0] as unknown[];
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as unknown[])[0]).toBe(0); // blockStart
    expect((blocks[0] as unknown[])[1]).toBe('0:1:0:0:3:1:1,5:2:0:0:5:1:1');
    expect(res[1]).toEqual([{ id: 1, cid: 50, endtime: 9 }]);
  });
});

describe('WorldCommands.getWorldCityInfo', () => {
  it('returns [] when the count is zero', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await cmd.getWorldCityInfo(ctx, [0])).toEqual([]);
  });

  it('flags the player own city as 0', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      {
        match: /from sys_city c, sys_user u/i,
        rows: [{ cid: 209355, citytype: 0, uid: 1001, union_id: 0 }],
      },
      { match: /select \* from sys_user where uid/i, rows: [{ uid: 1001, union_id: 0 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getWorldCityInfo(ctx, [1, 209355])) as Record<string, unknown>[];
    expect(res[0]!.flag).toBe(0);
  });

  it('flags an ally city as 1', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      {
        match: /from sys_city c, sys_user u/i,
        rows: [{ cid: 5, citytype: 0, uid: 2002, union_id: 7 }],
      },
      { match: /select \* from sys_user where uid/i, rows: [{ uid: 1001, union_id: 7 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getWorldCityInfo(ctx, [1, 5])) as Record<string, unknown>[];
    expect(res[0]!.flag).toBe(1);
  });

  it('flags an NPC city as free-to-take (5)', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      {
        match: /from sys_city c, sys_user u/i,
        rows: [{ cid: 5, citytype: 0, uid: 500, union_id: 0 }],
      },
      { match: /select \* from sys_user where uid/i, rows: [{ uid: 1001, union_id: 0 }] },
      NO(/from sys_union_relation/i),
      NO(/.*/),
    ]);
    const res = (await cmd.getWorldCityInfo(ctx, [1, 5])) as Record<string, unknown>[];
    expect(res[0]!.flag).toBe(5);
  });
});

describe('WorldCommands.getGovernInfo', () => {
  it('reports zero used when no schedule row exists', async () => {
    const { cmd } = build([
      NO(/from mem_city_schedule/i),
      { match: /select officepos from sys_user/i, rows: [{ officepos: 8 }] },
      { match: /from cfg_office_pos/i, rows: [{ name: '太守' }] },
      { match: /select type from sys_city/i, rows: [{ type: 1 }] },
      NO(/.*/),
    ]);
    const res = await cmd.getGovernInfo(ctx, [209355]);
    expect(res).toEqual(['太守', 3, 0]);
  });

  it('resets the used count across the UTC+8 day boundary', async () => {
    const yesterday = 1_000_000; // long before "now"
    const { cmd } = build([
      {
        match: /from mem_city_schedule/i,
        rows: [{ govern_count: 2, last_govern_time: yesterday }],
      },
      { match: /select officepos from sys_user/i, rows: [{ officepos: 8 }] },
      { match: /from cfg_office_pos/i, rows: [{ name: '太守' }] },
      { match: /select type from sys_city/i, rows: [{ type: 1 }] },
      NOW(2_000_000_000),
      NO(/.*/),
    ]);
    const res = await cmd.getGovernInfo(ctx, [209355]);
    expect(res[2]).toBe(0);
  });

  it('keeps the used count within the same day', async () => {
    const now = 2_000_000_000;
    const { cmd } = build([
      { match: /from mem_city_schedule/i, rows: [{ govern_count: 2, last_govern_time: now }] },
      { match: /select officepos from sys_user/i, rows: [{ officepos: 8 }] },
      { match: /from cfg_office_pos/i, rows: [{ name: '太守' }] },
      { match: /select type from sys_city/i, rows: [{ type: 1 }] },
      NOW(now),
      NO(/.*/),
    ]);
    const res = await cmd.getGovernInfo(ctx, [209355]);
    expect(res[2]).toBe(2);
  });
});

describe('WorldCommands.checkCanInvade', () => {
  it('allows invading a plain (type<2) target', async () => {
    const { cmd } = build([
      { match: /select type from sys_city where cid/i, rows: [{ type: 1 }] },
      NO(/.*/),
    ]);
    expect(await cmd.checkCanInvade(ctx, [1001])).toEqual([true]);
  });

  it('rejects when the union holds a third or less of the 郡', async () => {
    let totalSeen = false;
    const { cmd } = build([
      { match: /select type from sys_city where cid/i, rows: [{ type: 2 }] },
      { match: /select union_id from sys_user/i, rows: [{ union_id: 7 }] },
      { match: /from mem_world where wid/i, rows: [{ province: 3, jun: 4 }] },
      {
        // first count(*) is total, second is invaded
        match: /count\(\*\) from sys_city/i,
        get rows() {
          if (!totalSeen) {
            totalSeen = true;
            return [{ 'count(*)': 9 }];
          }
          return [{ 'count(*)': 1 }];
        },
      } as Respond,
      NO(/.*/),
    ]);
    const res = await cmd.checkCanInvade(ctx, [205]);
    expect(res).toEqual([false, 2, 9, 1]);
  });
});

describe('WorldCommands favourites', () => {
  it('rejects a duplicate favourite', async () => {
    const { cmd } = build([
      { match: /select \* from sys_favourites where uid = \? and cid/i, rows: [{ id: 1 }] },
      NO(/.*/),
    ]);
    await expect(cmd.addFavourites(ctx, [5])).rejects.toThrow('addFavourites.already_in_fav');
  });

  it('rejects when the favourites list is full', async () => {
    const { cmd } = build([
      NO(/select \* from sys_favourites where uid = \? and cid/i),
      { match: /count\(\*\) from sys_favourites/i, rows: [{ 'count(*)': 10 }] },
      NO(/.*/),
    ]);
    await expect(cmd.addFavourites(ctx, [5])).rejects.toThrow('addFavourites.fav_is_full');
  });

  it('inserts a city favourite and throws the success message', async () => {
    const { cmd, db } = build([
      NO(/select \* from sys_favourites where uid = \? and cid/i),
      { match: /count\(\*\) from sys_favourites/i, rows: [{ 'count(*)': 0 }] },
      { match: /from mem_world where wid/i, rows: [{ type: 0 }] },
      { match: /select name from sys_city where cid/i, rows: [{ name: '洛阳' }] },
      NO(/.*/),
    ]);
    await expect(cmd.addFavourites(ctx, [5])).rejects.toThrow('addFavourites.succ');
    expect(db.executed.some((q) => /insert into sys_favourites/i.test(q.sql))).toBe(true);
  });

  it('deleteFavourites refuses another player favourite', async () => {
    const { cmd } = build([
      { match: /select \* from sys_favourites where id/i, rows: [{ id: 3, uid: 9999 }] },
      NO(/.*/),
    ]);
    await expect(cmd.deleteFavourites(ctx, [3])).rejects.toThrow(
      'deleteFavourites.error_in_del_fav',
    );
  });

  it('setFavouritesComments updates and throws success', async () => {
    const { cmd, db } = build([
      { match: /select \* from sys_favourites where id/i, rows: [{ id: 3, uid: 1001 }] },
      NO(/.*/),
    ]);
    await expect(cmd.setFavouritesComments(ctx, [3, '前线'])).rejects.toThrow(
      'setFavouritesComments.succ',
    );
    expect(db.executed.some((q) => /update sys_favourites set comments/i.test(q.sql))).toBe(true);
  });

  it('getFavouritesList returns [cities, favourites]', async () => {
    const { cmd } = build([
      { match: /select cid, name from sys_city where uid/i, rows: [{ cid: 1, name: 'a' }] },
      {
        match: /select id, cid, name, comments from sys_favourites/i,
        rows: [{ id: 2, cid: 5, name: 'b', comments: '' }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getFavouritesList(ctx)) as unknown[];
    expect(res[0]).toEqual([{ cid: 1, name: 'a' }]);
    expect(res[1]).toEqual([{ id: 2, cid: 5, name: 'b', comments: '' }]);
  });
});

describe('WorldCommands.markCity', () => {
  it('rejects marking a plain city', async () => {
    const { cmd } = build([
      { match: /select \* from sys_city where cid = \? limit 1/i, rows: [{ cid: 5, type: 0 }] },
      NO(/.*/),
    ]);
    await expect(cmd.markCity(ctx, [5])).rejects.toThrow('MarkCity.only_for_famous_city');
  });

  it('rejects a player with no union', async () => {
    const { cmd } = build([
      { match: /select \* from sys_city where cid = \? limit 1/i, rows: [{ cid: 5, type: 2 }] },
      { match: /select union_id from sys_user/i, rows: [{ union_id: 0 }] },
      NO(/.*/),
    ]);
    await expect(cmd.markCity(ctx, [5])).rejects.toThrow('MarkCity.No_Union');
  });

  it('rejects a seat at or below rank 3', async () => {
    const { cmd } = build([
      { match: /select \* from sys_city where cid = \? limit 1/i, rows: [{ cid: 5, type: 2 }] },
      { match: /select union_id from sys_user/i, rows: [{ union_id: 7 }] },
      { match: /select \* from sys_union where id/i, rows: [{ id: 7 }] },
      { match: /select union_pos from sys_user/i, rows: [{ union_pos: 3 }] },
      NO(/.*/),
    ]);
    await expect(cmd.markCity(ctx, [5])).rejects.toThrow('MarkCity.No_Permission');
  });
});

describe('WorldCommands.getUserFields', () => {
  it('returns the wids of the held wild fields wrapped in an array', async () => {
    const { cmd } = build([
      { match: /select wid from mem_world m, sys_city s/i, rows: [{ wid: 101 }, { wid: 202 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getUserFields(ctx)) as unknown[];
    expect(res[0]).toEqual([{ wid: 101 }, { wid: 202 }]);
  });
});

describe('WorldCommands.getActionField', () => {
  it('returns [type, [-1]] when no activity field is configured', async () => {
    const { cmd } = build([NO(/from cfg_special_act/i), NO(/.*/)]);
    const res = (await cmd.getActionField(ctx, [1])) as unknown[];
    expect(res[0]).toBe(1);
    expect(res[1]).toEqual([-1]);
  });

  it('maps a live activity field cid to its wid', async () => {
    const { cmd } = build([
      { match: /from cfg_special_act/i, rows: [{ cid: 209355, count: 3, starttime: '00:00' }] },
      { match: /select unix_timestamp\(\)$/i, rows: [{ 'unix_timestamp()': 2_000_000_000 }] },
      { match: /unix_timestamp\(curdate\(\)\)/i, rows: [{ 'unix_timestamp(curdate())': 0 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getActionField(ctx, [0])) as unknown[];
    expect(res[0]).toBe(0);
    // cid2wid(209355) = block-packed wid; a positive number (not -1).
    expect((res[1] as number[])[0]).toBeGreaterThan(0);
  });
});

describe('WorldCommands.getOtherCityByName', () => {
  it('rejects an empty name', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.getOtherCityByName(ctx, [''])).rejects.toThrow(
      'searchcityname.enter_target_name',
    );
  });

  it('rejects a name longer than 8 characters', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.getOtherCityByName(ctx, ['九个字的城池名字啊'])).rejects.toThrow(
      'searchcityname.union_name_tooLong',
    );
  });

  it('throws target_union_not_exist when nothing matches', async () => {
    const { cmd } = build([NO(/from sys_city aa/i), NO(/.*/)]);
    await expect(cmd.getOtherCityByName(ctx, ['无此城'])).rejects.toThrow(
      'searchcityname.target_union_not_exist',
    );
  });

  it('returns the matched cities wrapped in a one-element array', async () => {
    const hit = { cid: 5, name: '长乐宫', uid: 1001, username: '长乐', unionname: null };
    const { cmd } = build([{ match: /from sys_city aa/i, rows: [hit] }, NO(/.*/)]);
    const res = (await cmd.getOtherCityByName(ctx, ['长乐'])) as unknown[];
    expect(res).toEqual([[hit]]);
  });
});

describe('WorldCommands.getOtherUnionAreaByName', () => {
  it('rejects an empty name', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.getOtherUnionAreaByName(ctx, [''])).rejects.toThrow(
      'addUnionRelation.enter_target_name',
    );
  });

  it('rejects a name longer than 8 characters', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.getOtherUnionAreaByName(ctx, ['九个字的联盟名字啊'])).rejects.toThrow(
      'addUnionRelation.union_name_tooLong',
    );
  });

  it('throws target_union_not_exist for an unknown union name', async () => {
    const { cmd } = build([NO(/select \* from sys_union where name/i), NO(/.*/)]);
    await expect(cmd.getOtherUnionAreaByName(ctx, ['无此盟'])).rejects.toThrow(
      'addUnionRelation.target_union_not_exist',
    );
  });

  it('assembles [name, provinceOwners, marks, "blue", id, areas]', async () => {
    const { cmd } = build([
      // getOtherUnionAreaByName: resolve union by name
      { match: /select \* from sys_union where name/i, rows: [{ id: 7, name: '天下第一' }] },
      // otherUnionArea: re-read the union by id
      { match: /select \* from sys_union where id/i, rows: [{ id: 7, name: '天下第一' }] },
      // provinceCityOwner: the 州城 list, then the per-row union-name lookup
      {
        match: /from sys_city c left join sys_user u .* type >= 3/i,
        rows: [
          {
            province: 1,
            type: 3,
            cid: 100,
            cityname: '洛阳',
            uid: 2002,
            union_id: 7,
            username: '张三',
          },
        ],
      },
      { match: /select name from sys_union where id/i, rows: [{ name: '天下第一' }] },
      // unionMarkCity -> clearMark: union_id, the marks, the mark owner (<=1000 so no relation
      // branch), then the expiry delete. The marks read is reused by unionMarkCity itself.
      { match: /select union_id from sys_user/i, rows: [{ union_id: 7 }] },
      { match: /from sys_union_mark where unionid/i, rows: [{ id: 1, cid: 50 }] },
      { match: /select uid from sys_city where cid/i, rows: [{ uid: 500 }] },
      { match: /delete from sys_union_mark/i, rows: [] },
      // unionArea: held 郡 cities, then each tile's province_jun row
      {
        match: /from sys_city c\s+join sys_user u on c.uid = u.uid where c.type = 2/i,
        rows: [{ cid: 60 }],
      },
      { match: /concat\(province, '_', jun\)/i, rows: [{ provincejun: '1_2' }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getOtherUnionAreaByName(ctx, ['天下第一'])) as unknown[];
    expect(res[0]).toBe('天下第一');
    expect(res[3]).toBe('blue');
    expect(res[4]).toBe(7);
    expect(res[5]).toEqual([{ provincejun: '1_2' }]);
    expect(Array.isArray(res[1])).toBe(true);
    expect(res[2]).toEqual([{ id: 1, cid: 50 }]);
  });
});
