import { Module } from '@nestjs/common';
import { GuideCommands } from './guide.commands';

/** GuideFunc.php. */
@Module({
  providers: [GuideCommands],
})
export class GuideModule {}
