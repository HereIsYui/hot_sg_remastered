import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpString, phpTrim } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

/** MailFunc.php `Mail_PAGE_CPP`: rows per page. */
const PAGE_SIZE = 10;
/** MailFunc.php `MAX_MAIL_COUNT`: inbox / outbox cap. */
const MAX_MAIL_COUNT = 100;
/** `sendPersonMail` finishes task goal 80 when the addressee is a real player (uid > 1000). */
const GOAL_SEND_MAIL = 80;
/** `sendPersonMail`: mailing uid 710 finishes goal 3101107. */
const GOAL_MAIL_710 = 3101107;
const NPC_UID_MAX = 1000;
const WELFARE_UID = 710;
/** `readSysMail` finishes task 290 (completeTaskWithTaskid). */
const TASK_READ_SYS_MAIL = 290;
/** `sys_user.state` 3: a role whose 君主名 is not set yet cannot send mail. */
const STATE_NO_NAME = 3;

type Row = Record<string, unknown>;

/**
 * MailFunc.php: the 邮件 dialog's inbox / outbox / 系统信 lists, reading and deleting a letter,
 * and sending a personal letter. `sendUnionMail` depends on the 联盟 module, which is not ported
 * yet, so it reports 暂未开放. The unread flag on the bottom bar's 邮件 button is `sys_alarm.mail`,
 * cleared here by `checkUnread` exactly as the original did. System mail to a single player is sent
 * by other modules through `MailService.send` (CoreModule, global) — the battle / report wave uses
 * it to deliver 战报 notices.
 */
@Injectable()
export class MailCommands {
  /** `$GLOBALS['getSysMail']['fromname']`: the 系统信 sender column, "系统". */
  private readonly sysFromName: string;

  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly tasks: TaskRules,
  ) {
    this.sysFromName = this.lang.tOrNull('getSysMail.fromname') ?? '系统';
  }

  private cell<T = unknown>(sqlText: ReturnType<typeof sql>): Promise<T | undefined> {
    return sqlText.execute(this.scope.db).then((r) => {
      const row = (r.rows as Row[])[0];
      if (!row) return undefined;
      return Object.values(row)[0] as T;
    });
  }

  private rows(sqlText: ReturnType<typeof sql>): Promise<Row[]> {
    return sqlText.execute(this.scope.db).then((r) => r.rows as Row[]);
  }

  /**
   * `getMail`: the list the dialog opens on. The original shows the inbox when it has unread
   * letters (trailing flag 0), else the 系统信 when those are unread (flag 1), else the inbox and
   * clears `sys_alarm.mail` (flag 0).
   */
  @GlobalCommand()
  async getMail(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const inboxUnread = phpIntval(
      await this.cell(
        sql`select count(*) from sys_mail_box where uid = ${uid} and recvstate = 0 and \`read\` = 0`,
      ),
    );
    if (inboxUnread !== 0) {
      const ret = await this.getInboxMail(ctx, [0]);
      ret.push(0);
      return ret;
    }
    const sysUnread = phpIntval(
      await this.cell(
        sql`select count(*) from sys_mail_sys_box where uid = ${uid} and \`read\` = 0`,
      ),
    );
    if (sysUnread !== 0) {
      const ret = await this.getSysMail(ctx, [0]);
      ret.push(1);
      return ret;
    }
    await sql`update sys_alarm set mail = '0' where uid = ${uid}`.execute(this.scope.db);
    const ret = await this.getInboxMail(ctx, [0]);
    ret.push(0);
    return ret;
  }

  /** `getInboxMail`: `[pageCount, page, rows]` of the inbox (recvstate 0), newest first. */
  @GlobalCommand()
  async getInboxMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    let page = phpIntval(param[0]);
    const mailCount = phpIntval(
      await this.cell(sql`select count(*) from sys_mail_box where uid = ${uid} and recvstate = 0`),
    );
    let pageCount = Math.ceil(mailCount / PAGE_SIZE);
    if (page >= pageCount) page = pageCount - 1;
    if (mailCount <= 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [pageCount, page];
    if (mailCount > 0) {
      const start = page * PAGE_SIZE;
      ret.push(
        await this.rows(
          sql`select mid, fromname, contentid, title, \`read\`, posttime from sys_mail_box
            where uid = ${uid} and recvstate = 0 order by posttime desc limit ${start}, ${PAGE_SIZE}`,
        ),
      );
    } else {
      await this.checkUnread(uid);
      ret.push([]);
    }
    return ret;
  }

  /** `getOutboxMail`: `[pageCount, page, rows]` of the outbox (sendstate 0). */
  @GlobalCommand()
  async getOutboxMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    let page = phpIntval(param[0]);
    const mailCount = phpIntval(
      await this.cell(
        sql`select count(*) from sys_mail_box where fromuid = ${uid} and sendstate = 0`,
      ),
    );
    let pageCount = Math.ceil(mailCount / PAGE_SIZE);
    if (page >= pageCount) page = pageCount - 1;
    if (mailCount <= 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [pageCount, page];
    if (mailCount > 0) {
      const start = page * PAGE_SIZE;
      ret.push(
        await this.rows(
          sql`select mid, name, contentid, title, \`read\`, posttime from sys_mail_box
            where fromuid = ${uid} and sendstate = 0 order by posttime desc limit ${start}, ${PAGE_SIZE}`,
        ),
      );
    } else {
      ret.push([]);
    }
    return ret;
  }

  /** `getSysMail`: `[pageCount, page, rows]` of 系统信, with a fixed 系统 sender name. */
  @GlobalCommand()
  async getSysMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    let page = phpIntval(param[0]);
    const mailCount = phpIntval(
      await this.cell(sql`select count(*) from sys_mail_sys_box where uid = ${uid}`),
    );
    let pageCount = Math.ceil(mailCount / PAGE_SIZE);
    if (page >= pageCount) page = pageCount - 1;
    if (mailCount <= 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [pageCount, page];
    if (mailCount > 0) {
      const start = page * PAGE_SIZE;
      ret.push(
        await this.rows(
          sql`select mid, contentid, title, ${this.sysFromName} as fromname, \`read\`, posttime
            from sys_mail_sys_box where uid = ${uid} order by posttime desc limit ${start}, ${PAGE_SIZE}`,
        ),
      );
    } else {
      await this.checkUnread(uid);
      ret.push([]);
    }
    return ret;
  }

  /** `deleteInboxMail`: hides the chosen letters (recvstate 1), then re-reads the inbox page. */
  @GlobalCommand()
  async deleteInboxMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const mids = this.midList(param[0]);
    const page = param[1];
    if (mids.length > 0) {
      await sql`update sys_mail_box set recvstate = 1
        where uid = ${uid} and mid in (${sql.join(mids)})`.execute(this.scope.db);
      await this.checkUnread(uid);
    }
    return this.getInboxMail(ctx, [page]);
  }

  /** `deleteOutboxMail`: hides the chosen sent letters (sendstate 1), then re-reads the outbox. */
  @GlobalCommand()
  async deleteOutboxMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const mids = this.midList(param[0]);
    const page = param[1];
    if (mids.length > 0) {
      await sql`update sys_mail_box set sendstate = 1
        where fromuid = ${uid} and mid in (${sql.join(mids)})`.execute(this.scope.db);
    }
    return this.getOutboxMail(ctx, [page]);
  }

  /** `deleteSysMail`: deletes the chosen 系统信 rows, then re-reads the 系统信 page. */
  @GlobalCommand()
  async deleteSysMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const mids = this.midList(param[0]);
    const page = param[1];
    if (mids.length > 0) {
      await sql`delete from sys_mail_sys_box
        where uid = ${uid} and mid in (${sql.join(mids)})`.execute(this.scope.db);
      await this.checkUnread(uid);
    }
    return this.getSysMail(ctx, [page]);
  }

  /** `readInboxMail`: the letter body; marks it read and refreshes the unread flag. */
  @GlobalCommand()
  async readInboxMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const mid = phpIntval(param[0]);
    const mail = (
      await this.rows(
        sql`select i.mid, i.name, i.fromname, i.title, i.posttime, c.content
          from sys_mail_box i left join sys_mail_content c on c.mid = i.contentid
          where i.mid = ${mid} and i.uid = ${uid}`,
      )
    )[0];
    if (phpEmpty(mail)) throw GameError.lang('readInboxMail.mail_lost');
    await sql`update sys_mail_box set \`read\` = 1 where mid = ${mid}`.execute(this.scope.db);
    await this.checkUnread(uid);
    return [mail];
  }

  /** `readOutboxMail`: the body of a letter the player sent. */
  @GlobalCommand()
  async readOutboxMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const mid = phpIntval(param[0]);
    const mail = (
      await this.rows(
        sql`select i.mid, i.name, i.fromname, i.title, i.posttime, c.content
          from sys_mail_box i left join sys_mail_content c on c.mid = i.contentid
          where i.mid = ${mid} and i.fromuid = ${uid}`,
      )
    )[0];
    if (phpEmpty(mail)) throw GameError.lang('readOutboxMail.mail_lost');
    return [mail];
  }

  /** `readSysMail`: the 系统信 body; marks it read, refreshes the flag and finishes task 290. */
  @GlobalCommand()
  async readSysMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const mid = phpIntval(param[0]);
    const mail = (
      await this.rows(
        sql`select u.name, ${this.sysFromName} as fromname, i.uid, i.title, i.\`read\`,
            i.posttime, c.content
          from sys_mail_sys_box i
          left join sys_mail_sys_content c on c.mid = i.contentid
          left join sys_user u on i.uid = u.uid
          where i.mid = ${mid} and i.uid = ${uid}`,
      )
    )[0];
    if (phpEmpty(mail)) throw GameError.lang('readSysMail.mail_lost');
    await sql`update sys_mail_sys_box set \`read\` = 1 where mid = ${mid}`.execute(this.scope.db);
    await this.checkUnread(uid);
    await this.tasks.completeTaskWithTaskid(uid, TASK_READ_SYS_MAIL);
    return [mail];
  }

  /**
   * `sendPersonMail`: a personal letter to another lord. The banned-word rate-limit logging the
   * original kept behind commented-out code is left out; the active checks (no 君主名, enemy block,
   * banned content, mailbox full, missing addressee) are ported. The 发件人名 the client sends is
   * ignored and re-read from the DB, as the original did.
   */
  @GlobalCommand()
  async sendPersonMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const userState = await this.cell(sql`select state from sys_user where uid = ${uid}`);
    if (!phpEmpty(userState) && phpIntval(userState) === STATE_NO_NAME) {
      throw GameError.lang('sendPersonMail.no_name');
    }
    // param: [fromname (ignored), toname, title, content]
    param.shift();
    const toname = phpTrim(param.shift());
    let title = phpString(param.shift());
    const content = phpString(param.shift());

    const titleToCheck = title;
    const contentToCheck = content;
    if (phpEmpty(title)) title = this.langTitle('sendPersonMail.untitled');
    await this.checkMailFull(uid);

    if (
      await this.exists(
        sql`select 1 from cfg_baned_mail_content where instr(${titleToCheck}, content) > 0`,
      )
    ) {
      throw GameError.lang('banned.word_illegal');
    }

    const fromname = phpString(await this.cell(sql`select name from sys_user where uid = ${uid}`));
    const touid = phpIntval(
      await this.cell(sql`select uid from sys_user where name = ${toname} limit 1`),
    );
    if (phpEmpty(toname) || phpEmpty(touid)) {
      throw GameError.lang('sendPersonMail.cant_find_addressee', toname);
    }

    const isEnemy = await this.cell(
      sql`select id from sys_user_relation where uid = ${touid} and tuid = ${uid} and type = 1`,
    );
    if (!phpEmpty(isEnemy)) throw GameError.lang('sendPersonMail.enemy');

    const banned = await this.rows(sql`select content from cfg_baned_mail_content`);
    for (const row of banned) {
      const word = phpString(row.content);
      if (word !== '' && contentToCheck.includes(word)) {
        await sql`insert into log_illegal_user (uid, name, count) values (${uid}, ${fromname}, 1)
          on duplicate key update count = count + 1`.execute(this.scope.db);
        throw GameError.lang('sendPersonMail.content_illegal');
      }
    }

    const inserted = await this.scope.db
      .insertInto('sys_mail_content')
      .values({ content, posttime: sql<number>`unix_timestamp()` })
      .executeTakeFirstOrThrow();
    const contentid = Number(inserted.insertId);
    await sql`insert into sys_mail_box
        (uid, name, fromuid, fromname, contentid, title, \`read\`, recvstate, sendstate, posttime, type)
      values (${touid}, ${toname}, ${uid}, ${fromname}, ${contentid}, ${title}, 0, 0, 0,
        unix_timestamp(), 1)`.execute(this.scope.db);
    await sql`insert into sys_alarm (uid, mail) values (${touid}, 1)
      on duplicate key update mail = 1`.execute(this.scope.db);

    if (touid > NPC_UID_MAX && uid !== touid) await this.tasks.completeTask(uid, GOAL_SEND_MAIL);
    if (touid === WELFARE_UID) await this.tasks.completeTask(uid, GOAL_MAIL_710);
    return [];
  }

  /**
   * `sendUnionMail`: 联盟群发. The actual broadcast (iterating the 盟 roster, spending 传音符) and
   * its per-member fan-out belong to the 联盟 module, which is not ported yet. MailFunc.php runs a
   * chain of guards BEFORE that send, though — the 君主名 / banned-word / mailbox-full / 盟主 seat
   * checks — and a non-champion is rejected there, never reaching the unported part. Those guards
   * are ported so the reachable error paths match PHP exactly; only once a caller clears them all
   * (a champion with enough 传音符) do we surface the not-ported error instead of broadcasting.
   */
  @GlobalCommand()
  async sendUnionMail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const args = [...param];
    const userstate = await this.cell(sql`select state from sys_user where uid = ${uid}`);
    if (!phpEmpty(userstate) && phpIntval(userstate) === STATE_NO_NAME) {
      throw GameError.lang('sendUnionMail.no_name');
    }
    args.shift(); // fromname arg is ignored; PHP re-reads it from sys_user.
    args.shift(); // unionid arg is ignored; PHP re-reads it from sys_user.
    const title = phpString(args.shift());
    args.shift(); // content — unused until the broadcast is ported.
    // PHP checks the banned-word table against the RAW title (before the 无标题 default and the
    // ［联盟］ prefix, which only matter for the unported broadcast), so that is all we build here.
    if (
      await this.exists(
        sql`select 1 from cfg_baned_mail_content where instr(${title}, content) > 0`,
      )
    ) {
      throw GameError.lang('banned.word_illegal');
    }
    await this.checkMailFull(uid);
    const union = (
      await this.rows(sql`select union_id, union_pos from sys_user where uid = ${uid}`)
    )[0];
    const unionid = phpIntval(union?.union_id);
    const unionpos = phpIntval(union?.union_pos);
    const leader = await this.cell(sql`select leader from sys_union where id = ${unionid}`);
    if (unionpos !== 4 && unionpos !== 5 && (phpEmpty(leader) || !phpLooseEquals(leader, uid))) {
      throw GameError.lang('sendUnionMail.not_champion');
    }
    // Cleared every reachable guard: the 传音符 cost and the broadcast fan-out are the 联盟 module's
    // and are not ported yet.
    throw GameError.raw('**联盟群发信暂未开放。');
  }

  /** `checkUnread`: clears `sys_alarm.mail` once neither mailbox has an unread letter. */
  private async checkUnread(uid: number): Promise<void> {
    const inbox = phpIntval(
      await this.cell(
        sql`select count(*) from sys_mail_box where uid = ${uid} and recvstate = 0 and \`read\` = 0`,
      ),
    );
    if (inbox !== 0) return;
    const sys = phpIntval(
      await this.cell(
        sql`select count(*) from sys_mail_sys_box where uid = ${uid} and \`read\` = 0`,
      ),
    );
    if (sys !== 0) return;
    await sql`update sys_alarm set mail = '0' where uid = ${uid}`.execute(this.scope.db);
  }

  /** `checkMailFull`: refuse once the inbox or outbox is over the cap. */
  private async checkMailFull(uid: number): Promise<void> {
    const recv = phpIntval(
      await this.cell(sql`select count(*) from sys_mail_box where uid = ${uid} and recvstate = 0`),
    );
    if (recv > MAX_MAIL_COUNT) throw GameError.lang('checkMailFull.inbox_full');
    const send = phpIntval(
      await this.cell(
        sql`select count(*) from sys_mail_box where fromuid = ${uid} and sendstate = 0`,
      ),
    );
    if (send > MAX_MAIL_COUNT) throw GameError.lang('checkMailFull.outbox_full');
  }

  /** `array_shift($param)` of mids, mapped through `intval` and non-zero (PHP `implode`). */
  private midList(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.map((v) => phpIntval(v)).filter((n) => n !== 0);
  }

  private async exists(sqlText: ReturnType<typeof sql>): Promise<boolean> {
    const rows = await sqlText.execute(this.scope.db);
    return rows.rows.length > 0;
  }

  /** `$GLOBALS[group][key]` for the literal 无标题 title; falls back to the key. */
  private langTitle(key: string): string {
    return this.lang.tOrNull(key) ?? key;
  }
}
