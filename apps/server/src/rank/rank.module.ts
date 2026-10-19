import { Module } from '@nestjs/common';
import { RankRebuild } from './rank-rebuild.service';
import { RankRewards } from './rank-rewards.service';

/** The rankings ReportCron.php rebuilds every hour and the rewards paid from them. */
@Module({
  providers: [RankRebuild, RankRewards],
  exports: [RankRebuild, RankRewards],
})
export class RankModule {}
