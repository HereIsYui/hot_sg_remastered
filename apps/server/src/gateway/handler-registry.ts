import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  AMF_METHOD,
  AMF_SERVICE,
  COMMAND_HANDLER,
  type CommandContext,
  type CommandHandlerMeta,
  type CommandKind,
  type ServiceContext,
} from './decorators';

export interface RegisteredCommand {
  name: string;
  kind: CommandKind;
  owner: string;
  invoke: (ctx: CommandContext, param: unknown[]) => unknown;
}

export interface RegisteredServiceMethod {
  service: string;
  method: string;
  invoke: (param: unknown[], ctx: ServiceContext) => unknown;
}

type AnyMethod = (...args: unknown[]) => unknown;

/** Collects decorated handlers from all providers; acts as the openfunc whitelist. */
@Injectable()
export class HandlerRegistry implements OnModuleInit {
  private readonly logger = new Logger(HandlerRegistry.name);
  private readonly commands = new Map<string, RegisteredCommand>();
  private readonly services = new Map<string, RegisteredServiceMethod>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || !wrapper.isDependencyTreeStatic()) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, AnyMethod>;
      const serviceName = this.reflector.get<string | undefined>(AMF_SERVICE, instance.constructor);
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const fn = proto[methodName];
        if (typeof fn !== 'function') continue;
        const cmd = this.reflector.get<CommandHandlerMeta | undefined>(COMMAND_HANDLER, fn);
        if (cmd) {
          this.addCommand({
            name: cmd.name ?? methodName,
            kind: cmd.kind,
            owner: `${instance.constructor.name}.${methodName}`,
            invoke: fn.bind(instance) as RegisteredCommand['invoke'],
          });
        }
        const amf = this.reflector.get<string | true | undefined>(AMF_METHOD, fn);
        if (amf) {
          if (!serviceName) {
            throw new Error(
              `${instance.constructor.name}.${methodName}: @AmfMethod needs @AmfService`,
            );
          }
          this.addService({
            service: serviceName,
            method: amf === true ? methodName : amf,
            invoke: fn.bind(instance) as RegisteredServiceMethod['invoke'],
          });
        }
      }
    }
    this.logger.log(`${this.commands.size} commands, ${this.services.size} service methods`);
  }

  addCommand(cmd: RegisteredCommand): void {
    const existing = this.commands.get(cmd.name);
    if (existing)
      throw new Error(`command ${cmd.name} registered by ${existing.owner} and ${cmd.owner}`);
    this.commands.set(cmd.name, cmd);
  }

  addService(m: RegisteredServiceMethod): void {
    const key = `${m.service}.${m.method}`;
    if (this.services.has(key)) throw new Error(`service method ${key} registered twice`);
    this.services.set(key, m);
  }

  command(name: string): RegisteredCommand | undefined {
    return this.commands.get(name);
  }

  serviceMethod(service: string, method: string): RegisteredServiceMethod | undefined {
    return this.services.get(`${service}.${method}`);
  }

  commandNames(): string[] {
    return [...this.commands.keys()].sort();
  }
}
