import { Module } from '@nestjs/common';
import { AchivementModule } from './achivement/achivement.module';
import { ArenaModule } from './activity/arena.module';
import { LoginActivityModule } from './activity/login-activity.module';
import { LuoyangBelongModule } from './activity/luoyang-belong.module';
import { LuoyangModule } from './activity/luoyang.module';
import { MarryModule } from './activity/marry.module';
import { PkModule } from './activity/pk.module';
import { AuthModule } from './auth/auth.module';
import { BattleLifecycleCommands } from './battle/battle-lifecycle.commands';
import { BattleModule } from './battle/battle.module';
import { BattlefieldTroopSupportModule } from './battle/battlefield-troop-support.module';
import { BATTLEFIELD_QUIT } from './battle/battlefield-troop-support.commands';
import { BattlefieldLifecycleModule } from './battle/battlefield-lifecycle.module';
import { BattlefieldModule } from './battlefield/battlefield.module';
import { BattleMoveModule } from './battlefield/battle-move.module';
import { BufferModule } from './buffer/buffer.module';
import { CityModule } from './city/city.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { FriendModule } from './friend/friend.module';
import { GmModule } from './gm/gm.module';
import { HonorModule } from './honor/honor.module';
import { LotteryModule } from './lottery/lottery.module';
import { TrickModule } from './trick/trick.module';
import { UnionModule } from './union/union.module';
import { MarketModule } from './market/market.module';
import { TaskModule } from './task/task.module';
import { DatabaseModule } from './db/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { GoodsModule } from './goods/goods.module';
import { GroundModule } from './ground/ground.module';
import { GuideModule } from './guide/guide.module';
import { HealthController } from './health/health.controller';
import { HeroModule } from './hero/hero.module';
import { MailModule } from './mail/mail.module';
import { PushModule } from './push/push.module';
import { RankModule } from './rank/rank.module';
import { ShopModule } from './shop/shop.module';
import { TickModule } from './tick/tick.module';
import { TroopModule } from './world/troop.module';
import { UserModule } from './user/user.module';
import { WorldModule } from './world/world.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    CoreModule,
    GatewayModule,
    TickModule,
    PushModule,
    AuthModule,
    UserModule,
    CityModule,
    RankModule,
    BufferModule,
    TaskModule,
    GuideModule,
    GoodsModule,
    GroundModule,
    HeroModule,
    ShopModule,
    WorldModule,
    MailModule,
    TroopModule,
    BattleModule,
    BattlefieldModule,
    // 阶段 9 战场 slices: S2a create/join lifecycle, S4a march & engagement, S4b
    // 援军/召军/回军/加速/探索. The S4b quit hook (callBackArmy bid=5001 auto-fail) wires
    // to BattleLifecycleCommands.quitBattle, exported by BattleModule above.
    BattlefieldLifecycleModule,
    BattleMoveModule,
    BattlefieldTroopSupportModule.register(
      {
        provide: BATTLEFIELD_QUIT,
        useFactory: (quit: BattleLifecycleCommands) => ({
          quitBattle: (uid: number) => quit.quitBattle({ uid, cid: 0, ip: 0, sip: '' }),
        }),
        inject: [BattleLifecycleCommands],
      },
      // The factory's inject needs BattleLifecycleCommands, which BattleModule exports.
      [BattleModule],
    ),
    FriendModule,
    UnionModule,
    MarketModule,
    TrickModule,
    AchivementModule,
    LotteryModule,
    HonorModule,
    PkModule,
    ArenaModule,
    LoginActivityModule,
    LuoyangModule,
    LuoyangBelongModule,
    MarryModule,
    GmModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
