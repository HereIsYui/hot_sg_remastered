import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';

/** Columns of `sys_alarm`: unread-notification flags shown on the client's buttons. */
export type AlarmKind = 'mail' | 'task' | 'report' | 'troops' | 'friend' | 'enemy' | 'union';

/** System mail helpers from utils.php / MailFunc.php. */
@Injectable()
export class MailService {
  constructor(private readonly scope: DbScope) {}

  /** `insert into sys_alarm (uid, <kind>) values (uid, 1) on duplicate key update <kind>=1`. */
  async raiseAlarm(uid: number, kind: AlarmKind): Promise<void> {
    await sql`insert into sys_alarm (uid, ${sql.ref(kind)}) values (${uid}, 1)
      on duplicate key update ${sql.ref(kind)} = 1`.execute(this.scope.db);
  }

  /** Puts mail `contentid` (a sys_mail_sys_content id, or a fixed template id) into a mailbox. */
  async deliver(uid: number, contentid: number, title: string): Promise<void> {
    await this.scope.db
      .insertInto('sys_mail_sys_box')
      .values({ uid, contentid, title, read: 0, posttime: unixNow() })
      .execute();
  }

  /** utils.php::sendSysMail and MailFunc.php::sendSysMailToUser (identical effect). */
  async send(uid: number, title: string, content: string): Promise<void> {
    const result = await this.scope.db
      .insertInto('sys_mail_sys_content')
      .values({ content, posttime: unixNow() })
      .executeTakeFirstOrThrow();
    await this.deliver(uid, Number(result.insertId), title);
    await this.raiseAlarm(uid, 'mail');
  }
}
