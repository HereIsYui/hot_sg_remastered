import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { TaskModule } from '../task/task.module';
import { GmCommands } from './gm.commands';
import { GmController } from './gm.controller';
import { GmTokenGuard } from './gm-token.guard';

/**
 * The GM toolbox (design/02-开发计划.md, 阶段 10): an ops-only HTTP surface under `api/gm`
 * guarded by the GM_TOKEN shared token, replacing the original manage/*.php scripts and the
 * 修改器. Not part of the command gateway — GM is not a player command. WorldRefreshService is
 * reached through ModuleRef because WorldModule keeps it internal.
 */
@Module({
  imports: [CityModule, TaskModule],
  controllers: [GmController],
  providers: [GmCommands, GmTokenGuard],
})
export class GmModule {}
