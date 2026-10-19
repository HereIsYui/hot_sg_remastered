import { Module } from '@nestjs/common';
import { BufferCommands } from './buffer.commands';

/** BufferFunc.php. */
@Module({
  providers: [BufferCommands],
})
export class BufferModule {}
