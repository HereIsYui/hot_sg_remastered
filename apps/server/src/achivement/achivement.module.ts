import { Module } from '@nestjs/common';
import { AchivementCommands } from './achivement.commands';

/** AchivementFunc.php — the read-only achievement queries. */
@Module({
  providers: [AchivementCommands],
})
export class AchivementModule {}
