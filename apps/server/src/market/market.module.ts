import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { TaskModule } from '../task/task.module';
import { AutoTransTick } from './auto-trans.tick';
import { MarketCommands } from './market.commands';
import { MarketRules } from './market-rules.service';
import { MerchantCommands } from './merchant.commands';
import { PlayerTradeCommands } from './player-trade.commands';
import { TradeTick } from './trade.tick';

/** MarketFunc.php: automatic transport, merchant and player trades, and their settlement. */
@Module({
  imports: [CityModule, TaskModule],
  providers: [
    MarketCommands,
    MarketRules,
    MerchantCommands,
    PlayerTradeCommands,
    AutoTransTick,
    TradeTick,
  ],
})
export class MarketModule {}
