import { Inject, Injectable } from '@nestjs/common';
import { GameError } from '../common/game-error';
import { DATABASE, type Database } from '../db/database.module';

/** Ownership checks from `utils.php`. */
@Injectable()
export class OwnershipService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async ownsCity(cid: number, uid: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('sys_city')
      .select('cid')
      .where('cid', '=', cid)
      .where('uid', '=', uid)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** utils.php::checkCityOwner */
  async checkCityOwner(cid: number, uid: number): Promise<void> {
    if (!(await this.ownsCity(cid, uid))) throw GameError.raw('not_user_city');
  }

  /** utils.php::checkCityExist */
  async checkCityExist(cid: number, uid: number): Promise<void> {
    if (!(await this.ownsCity(cid, uid))) throw GameError.lang('checkCityExist.no_city_info');
  }
}
