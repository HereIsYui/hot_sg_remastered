import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpEmpty, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

/** Small helpers shared by the 校场 commands (GroundFunc.php). */
@Injectable()
export class GroundRules {
  constructor(
    private readonly scope: DbScope,
    private readonly random: RandomService,
  ) {}

  /** PHP `rand($min,$max)` (inclusive); difftest scripts fix the source. */
  rand(min: number, max: number): number {
    return this.random.randRange(min, max);
  }

  /** PHP `(string)$v` / `addslashes`-free string coercion of a command argument. */
  str(v: unknown): string {
    return phpString(v);
  }

  /**
   * setAttackTactics packing: `$count` groups of `$size` fields each, taken off the front of
   * `param`, joined `a,b,c` within a group and `;` between groups.
   */
  packGroups(param: unknown[], count: number, size: number): string {
    const groups: string[] = [];
    for (let i = 0; i < count; i++) {
      const fields: string[] = [];
      for (let j = 0; j < size; j++) fields.push(this.str(param.shift()));
      groups.push(fields.join(','));
    }
    return groups.join(';');
  }

  /** utils.php::getSpacialSoldierId: the city's special soldier id (non-type-4), 0 for none. */
  async specialSoldierId(cid: number): Promise<unknown> {
    const sid = (
      await sql<Row>`select sid from cfg_soldier_special_city
        where cid = ${cid} and type <> '4'`.execute(this.scope.db)
    ).rows[0]?.sid;
    return phpEmpty(sid) ? 0 : sid;
  }
}
