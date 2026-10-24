import { Injectable } from '@nestjs/common';
import { GlobalCommand } from '../gateway/decorators';

/**
 * WorldFunc.php action commands left for a later wave. They are registered so the openfunc
 * whitelist and the client's command names still resolve, but each throws a `not ported` error
 * (the client shows the standard 暂未开放 placeholder). Porting them needs the battle / troop
 * dispatch pipeline and the union/city-merge flows:
 *
 *  - `governOthers`        — issue a 政令 against another city (needs addCityResources / soldier moves).
 *  - `startWar`            — declare a personal war (needs sendReport + union event feed).
 *  - `unionAssit`          — buy a 2h 免战 for an ally (needs addMoney + mem_user_buffer).
 *  - `mergeCity`           — CityMergeFunc.php city merge (whole separate flow).
 */
@Injectable()
export class WorldStubCommands {
  @GlobalCommand()
  governOthers(): never {
    throw new Error('governOthers: 政令 not ported');
  }

  @GlobalCommand()
  startWar(): never {
    throw new Error('startWar: war declaration not ported');
  }

  @GlobalCommand()
  unionAssit(): never {
    throw new Error('unionAssit: union assist not ported');
  }

  @GlobalCommand()
  mergeCity(): never {
    throw new Error('mergeCity: city merge not ported');
  }
}
