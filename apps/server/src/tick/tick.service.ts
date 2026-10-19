import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TICK_HANDLER, type TickHandlerMeta } from './tick.decorator';

export interface TickHandlerEntry {
  name: string;
  order: number;
  run: () => unknown;
}

export interface TickReport {
  startedAt: number;
  durationMs: number;
  failed: string[];
}

const INTERVAL_NAME = 'settlement-tick';

/**
 * Replaces the closed-source backend that requested `cfg_js.php` every 3 seconds.
 * Handlers run sequentially in `order`; a failing handler is logged and does not stop the
 * rest (in PHP an uncaught exception aborted the remaining handlers for that tick).
 */
@Injectable()
export class TickService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TickService.name);
  private handlers: TickHandlerEntry[] = [];
  private running: Promise<TickReport> | null = null;
  private skipped = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.handlers = this.discover();
    this.logger.log(
      `${this.handlers.length} tick handlers${this.handlers.length ? `: ${this.handlers.map((h) => h.name).join(', ')}` : ''}`,
    );
    if (!this.config.TICK_ENABLED) {
      this.logger.warn('settlement tick disabled (TICK_ENABLED=false)');
      return;
    }
    const timer = setInterval(() => void this.tick(), this.config.TICK_INTERVAL_MS);
    this.scheduler.addInterval(INTERVAL_NAME, timer);
  }

  onApplicationShutdown(): void {
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) {
      this.scheduler.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Scheduled entry point: skips (and counts) a tick while the previous one is still running. */
  async tick(): Promise<TickReport | null> {
    if (this.running) {
      this.skipped++;
      if (this.skipped === 1 || this.skipped % 20 === 0) {
        this.logger.warn(`previous tick still running, skipped ${this.skipped} tick(s)`);
      }
      return null;
    }
    this.skipped = 0;
    return this.runOnce();
  }

  /** Runs one settlement pass now (tests, GM tools); concurrent callers share the same pass. */
  runOnce(): Promise<TickReport> {
    this.running ??= this.execute().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Runs only the handlers of one `TickOrder` slot, letting their errors through. */
  async runSlot(order: number): Promise<string[]> {
    const slot = this.handlers.filter((h) => h.order === order);
    for (const h of slot) await h.run();
    return slot.map((h) => h.name);
  }

  register(entry: TickHandlerEntry): void {
    this.handlers = [...this.handlers, entry].sort((a, b) => a.order - b.order);
  }

  get handlerNames(): string[] {
    return this.handlers.map((h) => h.name);
  }

  private async execute(): Promise<TickReport> {
    const startedAt = Date.now();
    const failed: string[] = [];
    for (const h of this.handlers) {
      try {
        await h.run();
      } catch (err) {
        failed.push(h.name);
        this.logger.error(
          `${h.name} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }
    }
    return { startedAt, durationMs: Date.now() - startedAt, failed };
  }

  private discover(): TickHandlerEntry[] {
    const found: TickHandlerEntry[] = [...this.handlers];
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || !wrapper.isDependencyTreeStatic()) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, () => unknown>;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const fn = proto[methodName];
        if (typeof fn !== 'function') continue;
        const meta = this.reflector.get<TickHandlerMeta | undefined>(TICK_HANDLER, fn);
        if (meta) {
          found.push({
            name: `${instance.constructor.name}.${methodName}`,
            order: meta.order,
            run: fn.bind(instance),
          });
        }
      }
    }
    return found.sort((a, b) => a.order - b.order);
  }
}
