import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { MarryCommands } from './marry.commands';
import { ArenaModule } from './arena.module';

/**
 * MarrySystemFunc.php（MarrySystem 服务）：君主历练（sys_king_expr 的命令侧，tick 结算在
 * hero-expr.tick.ts）、红颜好感/提亲/分手（proposeMarry 依赖 ArenaModule 导出的 PkEngine，
 * 即 PKFunc.php::startUserPK 的征战斗将引擎）、夫人怀孕接生与孩子培养（sys_user_child →
 * herotype 10001 子将）。
 *
 * 白名单里的 sendGift / getMotherInfo 是 PHP 无定义的幽灵命令，刻意不注册——新网关对未知命令
 * 回裸头部，与原版 `function_exists` 失败转入 WizardFunc 后的行为一致。
 */
@Module({
  imports: [TaskModule, ArenaModule],
  providers: [MarryCommands],
})
export class MarryModule {}
