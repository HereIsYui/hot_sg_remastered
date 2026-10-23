import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BufferModule } from './buffer/buffer.module';
import { CityModule } from './city/city.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './db/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { GoodsModule } from './goods/goods.module';
import { GroundModule } from './ground/ground.module';
import { GuideModule } from './guide/guide.module';
import { HealthController } from './health/health.controller';
import { HeroModule } from './hero/hero.module';
import { PushModule } from './push/push.module';
import { RankModule } from './rank/rank.module';
import { ShopModule } from './shop/shop.module';
import { TaskModule } from './task/task.module';
import { TickModule } from './tick/tick.module';
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
