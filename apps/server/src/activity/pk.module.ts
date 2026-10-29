import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { PkCommands } from './pk.commands';

/**
 * PKFunc.php — the 过关斩将 (征战) half: the standalone 3v3 hero-round campaign ladder
 * (loadCampaignInitData / getOneBattleRet / regetCampaignMaxData / getPkFirstReward /
 * loadPKRewardRank / buyJunlingFunc / getAllHeroByUid). The arena half of the same file
 * (startPK / allowPK / holdBattleHeroInfo …) is the battlefield family's, not this module's.
 */
@Module({
  imports: [TaskModule],
  providers: [PkCommands],
  exports: [PkCommands],
})
export class PkModule {}
