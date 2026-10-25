import { Module } from '@nestjs/common';
import { MarketCommands } from './market.commands';

/** MarketFunc.php wave 4: the 自动运输 scheduling slice; the trade rows and merchants later. */
@Module({
  providers: [MarketCommands],
})
export class MarketModule {}
