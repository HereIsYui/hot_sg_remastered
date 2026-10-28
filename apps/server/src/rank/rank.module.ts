import { Module } from '@nestjs/common';
import { RankCommands } from './rank.commands';
import { StatCommands } from './stat.commands';
import { RankRebuild } from './rank-rebuild.service';
import { RankRewardCommands } from './rank-reward.commands';
import { RankRewards } from './rank-rewards.service';

/** The rankings ReportCron.php rebuilds every hour and the rewards paid from them. */
@Module({
  providers: [RankCommands, RankRewardCommands, RankRebuild, RankRewards, StatCommands],
  exports: [RankRebuild, RankRewards],
})
export class RankModule {}
