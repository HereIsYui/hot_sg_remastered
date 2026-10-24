import { Module } from '@nestjs/common';
import { FriendCommands } from './friend.commands';
import { FriendStubCommands } from './friend-stub.commands';

/** FriendFunc.php: the 好友/仇人 relation commands; the 51-platform set stays stubbed. */
@Module({
  providers: [FriendCommands, FriendStubCommands],
})
export class FriendModule {}
