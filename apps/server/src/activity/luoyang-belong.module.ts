import { Module } from '@nestjs/common';
import { LuoyangBelongCommands } from './luoyang-belong.commands';

/**
 * LuoyangFunc.php 洛阳归属 family (openfunc lang.php:2650/2652/2654/2656) plus RankFunc.php:488
 * getBeiZhanLuoYangProgress — the holder side of 洛阳. The battle-side commands of the same
 * LuoyangFunc.php live in LuoyangModule (luoyang.commands.ts).
 */
@Module({
  providers: [LuoyangBelongCommands],
  exports: [LuoyangBelongCommands],
})
export class LuoyangBelongModule {}
