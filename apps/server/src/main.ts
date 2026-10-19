import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { loadConfig } from './config/app-config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: config.LOG_JSON }),
  });
  app.enableCors();
  app.enableShutdownHooks();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(config.PORT);
  Logger.log(`server listening on http://localhost:${config.PORT}`, 'Bootstrap');
}

void bootstrap();
