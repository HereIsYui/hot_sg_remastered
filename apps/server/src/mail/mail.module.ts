import { Module } from '@nestjs/common';
import { MailCommands } from './mail.commands';

/** MailFunc.php: the 邮件 dialog commands (inbox / outbox / 系统信, read, delete, send). */
@Module({
  providers: [MailCommands],
})
export class MailModule {}
