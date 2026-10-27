import { Module } from '@nestjs/common';
import { UnionCommands } from './union.commands';
import { UnionRules } from './union-rules.service';
import { MemberCommands } from './member.commands';
import { LeaveCommands } from './leave.commands';
import { InfoCommands } from './info.commands';
import { DiplomacyCommands } from './diplomacy.commands';
import { CityCommands } from './city.commands';
import { AreaCommands } from './area.commands';
import { TaskModule } from '../task/task.module';

/** UnionFunc.php: founding, membership, profiles, diplomacy, reports and union-city views. */
@Module({
  imports: [TaskModule],
  providers: [
    UnionCommands,
    UnionRules,
    MemberCommands,
    LeaveCommands,
    InfoCommands,
    DiplomacyCommands,
    CityCommands,
    AreaCommands,
  ],
})
export class UnionModule {}
