import { Global, Module } from '@nestjs/common';
import { CityRules } from './city-rules.service';
import { GameStateService } from './game-state.service';
import { GoodsRules } from './goods-rules.service';
import { HeroRules } from './hero-rules.service';
import { MailService } from './mail.service';
import { OwnershipService } from './ownership.service';
import { RandomService } from './random.service';
import { ReportService } from './report.service';
import { TaskRules } from './task-rules.service';
import { UserRules } from './user-rules.service';

const providers = [
  CityRules,
  GameStateService,
  GoodsRules,
  HeroRules,
  MailService,
  OwnershipService,
  RandomService,
  ReportService,
  TaskRules,
  UserRules,
];

/** Shared game rules ported from utils.php / UtilsExtend.php / global.php. */
@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
