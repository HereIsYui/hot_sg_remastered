import type { TableRule } from '../lib/difftest/normalize.ts';

/** 每日大礼包 gids; giveDalibao picks one of the two with mt_rand. */
const DAILY_BOXES = new Set(['50186', '50187']);

/**
 * The special-soldier city list ("<br/>州:城(x,y),   城(x,y),   …" + text): provinces come in
 * order, cities within a province do not, so entries are compared as a sorted set.
 */
function unorderedCityList(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('<br/>')) return value;
  const entries: string[] = [];
  let text = '';
  for (const segment of value.split('<br/>').slice(1)) {
    const colon = segment.indexOf(':');
    const province = segment.slice(0, colon);
    for (const token of segment.slice(colon + 1).split(/\),\s+/)) {
      if (/\(\d+,\d+$/.test(token)) entries.push(`${province}/${token})`);
      else text += token;
    }
  }
  return [...entries.sort(), text].join('|');
}

/**
 * Comparison rules for tables whose rows legitimately differ between the two servers.
 * Tables not listed are compared column by column after normalization.
 */
export const tableRules: Record<string, TableRule> = {
  sys_goods: { skip: (row) => DAILY_BOXES.has(String(row.gid)) },
  sys_inform: { offsets: ['starttime', 'endtime'] },
  sys_mail_sys_content: { map: { content: unorderedCityList } },
  // Random tile: only the ownership change is meaningful, not the tile's terrain.
  mem_world: { only: ['wid', 'ownercid', 'type', 'province', 'state'] },
  // Next random city events: midnight + 86400 * rand().
  mem_city_schedule: { ignore: ['next_good_event', 'next_bad_event'] },
  sys_building: { offsets: ['state_endtime'] },
  mem_building_upgrading: { offsets: ['state_endtime'] },
  mem_building_destroying: { offsets: ['state_endtime'] },
  sys_technic: { offsets: ['state_starttime', 'state_endtime'] },
  mem_technic_upgrading: { offsets: ['state_endtime'] },
  sys_city_draftqueue: { offsets: ['queuetime', 'state_starttime'] },
  mem_city_draft: { offsets: ['state_endtime'] },
  log_soldier_convert: { offsets: ['time'] },
};
