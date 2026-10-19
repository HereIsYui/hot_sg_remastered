import { Module } from '@nestjs/common';
import { CityFoundingService } from './city-founding.service';
import { UserCommands } from './user.commands';

/** UserFunc.php: player profile, role creation and city founding. */
@Module({
  providers: [CityFoundingService, UserCommands],
})
export class UserModule {}
