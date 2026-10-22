import { i18n } from '../i18n';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** A rumor in the 市井传闻 list (`sys_city_rumor`); only `id`/`name`/`type` are shown there. */
export interface Rumor {
  id: number;
  name: string;
  type: number;
}

export function parseRumorList(reply: unknown[]): Rumor[] {
  const rows = Array.isArray(reply) ? (reply as Row[]) : [];
  return rows
    .filter((r): r is Row => !!r && typeof r === 'object')
    .map((r) => ({ id: int(r.id), name: str(r.name), type: int(r.type) }));
}

/** The detail a clicked rumor expands to (`RumorDialog.onGetRumor`). */
export interface RumorDetail {
  id: number;
  price: number;
  type: number;
  name: string;
  /** The HTML blurb shown in the right pane. */
  description: string;
  /** `_RumorDialog_Button5.visible`: 详细询问 is offered (the hero is locatable). */
  showDetail: boolean;
  /** `_RumorDialog_Button4/6.visible`: 领取任务 / 结交 are offered (a famous-hero rumor). */
  showRecord: boolean;
}

/**
 * `RumorDialog.onGetRumor`: turns the `[rumor, info, locationMsg, showDetail, showRecord]` reply
 * into the detail header. Only the famous-hero rumor (type 0) is ported on the server; a type
 * 1 / 2 (任务物品 / 军队) rumor needs the world-map task system of a later stage, so the server
 * throws there and this branch is never reached.
 */
export function parseRumorDetail(reply: unknown[]): RumorDetail {
  const rest = [...reply];
  const rumor = (rest.shift() ?? {}) as Row;
  const type = int(rumor.type);
  let name = '';
  let description = '';
  if (type === 0) {
    const info = (rest.shift() ?? {}) as Row;
    name = str(info.name);
    description = i18n('Hotel_RumorDialogSrc_1') + name;
    if (str(info.zi).length > 0) description += i18n('Hotel_RumorDialogSrc_2') + str(info.zi);
    description += i18n('Hotel_RumorDialogSrc_3');
    description += str(info.introduce) + '<br/>';
  } else if (type === 1) {
    const info = (rest.shift() ?? {}) as Row;
    name = str(info.name);
    description = i18n('Hotel_RumorDialogSrc_4') + str(info.description) + '<br/>';
  } else if (type === 2) {
    const info = (rest.shift() ?? {}) as Row;
    name = str(info.name);
    description = i18n('Hotel_RumorDialogSrc_11') + str(info.introduce) + '<br/>';
  }
  const locationMsg = str(rest.shift());
  if (locationMsg !== '') description += i18n('Hotel_RumorDialogSrc_5') + locationMsg;
  const showDetail = Boolean(rest.shift());
  const showRecord = Boolean(rest.shift());
  return {
    id: int(rumor.id),
    price: int(rumor.price),
    type,
    name,
    description,
    showDetail,
    showRecord,
  };
}
