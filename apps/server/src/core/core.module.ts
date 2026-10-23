import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CityRules } from './city-rules.service';
import { GameStateService } from './game-state.service';
import { GoodsRules } from './goods-rules.service';
import { HeroRules } from './hero-rules.service';
import { MailService } from './mail.service';
import { OwnershipService } from './ownership.service';
import { RandomService, ScriptedRandom } from './random.service';
import { ReportService } from './report.service';
import { ScriptedRandomMiddleware } from './scripted-random.middleware';
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
  ScriptedRandom,
  ReportService,
  TaskRules,
  UserRules,
];

/** Shared game rules ported from utils.php / UtilsExtend.php / global.php. */
@Global()
@Module({
  providers: [...providers, ScriptedRandomMiddleware],
  exports: providers,
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Differential-test scripted RNG; a no-op unless TICK_DEBUG_ENDPOINT is on and the request
    // carries the X-Difftest-Rng header.
    consumer.apply(ScriptedRandomMiddleware).forRoutes('*');
  }
}
