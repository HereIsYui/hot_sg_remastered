import { Module } from '@nestjs/common';
import { CityFoundingService } from './city-founding.service';
import { PasswordCommands } from './password.commands';
import { UserStateCommands } from './user-state.commands';
import { UserCommands } from './user.commands';

/** UserFunc.php: player profile, role creation and city founding. */
@Module({
  providers: [CityFoundingService, PasswordCommands, UserCommands, UserStateCommands],
})
export class UserModule {}
