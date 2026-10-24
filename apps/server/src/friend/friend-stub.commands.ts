import { Injectable } from '@nestjs/common';
import { GlobalCommand } from '../gateway/decorators';

/**
 * FriendFunc.php commands the original's openfunc whitelist ($GLOBALS['n'] in lang.php) does
 * NOT list — addUserRelation, removeRelation — plus the 51-platform set
 * (get51User:66, ignoreFiendJoin:70, addFriend:76, invite51Friend:82), external integrations the
 * single-player build never defines. Everything here stays registered so the client's command
 * names still resolve: the non-whitelisted three answer `$funcName + 你异常了!!!` exactly as
 * Command.php:88 does, the 51 set throws the standard `not ported` placeholder.
 */
@Injectable()
export class FriendStubCommands {
  /** `Command.php:88`: a command outside the openfunc whitelist. */
  private notWhitelisted(name: string): never {
    throw new Error(`${name}你异常了!!!`);
  }

  @GlobalCommand()
  addUserRelation(): never {
    this.notWhitelisted('addUserRelation');
  }

  @GlobalCommand()
  removeRelation(): never {
    this.notWhitelisted('removeRelation');
  }

  @GlobalCommand()
  get51User(): never {
    throw new Error('get51User: 51-platform friends not ported');
  }

  @GlobalCommand()
  ignoreFiendJoin(): never {
    throw new Error('ignoreFiendJoin: 51-platform friends not ported');
  }

  @GlobalCommand()
  addFriend(): never {
    throw new Error('addFriend: 51-platform friends not ported');
  }

  @GlobalCommand()
  invite51Friend(): never {
    throw new Error('invite51Friend: 51-platform friends not ported');
  }
}
