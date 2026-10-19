import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CityModule } from './city/city.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './db/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthController } from './health/health.controller';
import { PushModule } from './push/push.module';
import { RankModule } from './rank/rank.module';
import { TickModule } from './tick/tick.module';
import { UserModule } from './user/user.module';

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
  ],
  controllers: [HealthController],
})
export class AppModule {}
