import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { PUSH_ENDPOINT } from '@hot/shared';
import type { WebSocket } from 'ws';
import { SessionService } from '../gateway/session.service';
import { PushService } from './push.service';

export const PUSH_CLOSE_UNAUTHORIZED = 4001;

/** WebSocket endpoint: `ws://host/ws?uid=…&sid=…` with the sid issued by Login.doLogin. */
@WebSocketGateway({ path: PUSH_ENDPOINT })
export class PushGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PushGateway.name);

  constructor(
    private readonly push: PushService,
    private readonly sessions: SessionService,
  ) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const uid = await this.sessions.verify(
        url.searchParams.get('uid'),
        url.searchParams.get('sid'),
      );
      this.push.attach(uid, client);
      client.on('message', (data) => void this.push.receive(client, data.toString()));
    } catch {
      this.logger.debug('rejected push connection with invalid session');
      client.close(PUSH_CLOSE_UNAUTHORIZED, 'invalid_user_auth');
    }
  }

  handleDisconnect(client: WebSocket): void {
    this.push.detach(client);
  }
}
