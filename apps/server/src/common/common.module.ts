import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { LANG_TABLE, LangService, loadLangTable } from './lang.service';

@Global()
@Module({
  providers: [
    {
      provide: LANG_TABLE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => loadLangTable(config.LANG_FILE),
    },
    LangService,
  ],
  exports: [LangService],
})
export class CommonModule {}
