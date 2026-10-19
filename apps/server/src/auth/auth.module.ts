import { Module } from '@nestjs/common';
import { LoginService } from './login.service';
import { RealLoginService } from './real-login.service';

/** Login.php: local-account login and the login queue. */
@Module({
  providers: [LoginService, RealLoginService],
  exports: [RealLoginService],
})
export class AuthModule {}
