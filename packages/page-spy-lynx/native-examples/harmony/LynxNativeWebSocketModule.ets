import { LynxContext, LynxModule } from '@lynx/lynx';
import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';

type NativeWebSocketEvent = {
  type: string;
  socketId: string;
  data?: string;
  code?: number;
  reason?: string;
  message?: string;
};

type DrainEventsCallback = (events: NativeWebSocketEvent[]) => void;

export class LynxNativeWebSocketModule extends LynxModule {
  private sockets: Map<string, webSocket.WebSocket> = new Map();

  private events: Map<string, NativeWebSocketEvent[]> = new Map();

  constructor(context: LynxContext, param?: Object) {
    super(context, param);
  }

  public connect(socketId: string, url: string): void {
    this.events.set(socketId, []);

    const socket = webSocket.createWebSocket();
    this.sockets.set(socketId, socket);

    socket.on('open', () => {
      this.emit(socketId, { type: 'open', socketId });
    });

    socket.on('message', (_error: BusinessError, value: string | ArrayBuffer) => {
      this.emit(socketId, {
        type: 'message',
        socketId,
        data: this.stringifyMessage(value),
      });
    });

    socket.on('close', (_error: BusinessError, value: webSocket.CloseResult) => {
      this.emit(socketId, {
        type: 'close',
        socketId,
        code: value?.code,
        reason: value?.reason || '',
      });
      this.cleanup(socketId);
    });

    socket.on('error', (error: BusinessError) => {
      this.emit(socketId, {
        type: 'error',
        socketId,
        message: error?.message || 'WebSocket error',
      });
      this.cleanup(socketId);
    });

    try {
      socket.connect(url, (error: BusinessError) => {
        if (error) {
          this.emit(socketId, {
            type: 'error',
            socketId,
            message: error.message || 'WebSocket connect error',
          });
          this.cleanup(socketId);
        }
      });
    } catch (error) {
      this.emit(socketId, {
        type: 'error',
        socketId,
        message: this.getErrorMessage(error),
      });
      this.cleanup(socketId);
    }
  }

  public send(socketId: string, data: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }

    try {
      socket.send(data, (error: BusinessError) => {
        if (error) {
          this.emit(socketId, {
            type: 'error',
            socketId,
            message: error.message || 'WebSocket send error',
          });
          this.cleanup(socketId);
        }
      });
    } catch (error) {
      this.emit(socketId, {
        type: 'error',
        socketId,
        message: this.getErrorMessage(error),
      });
      this.cleanup(socketId);
    }
  }

  public close(socketId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      this.emit(socketId, {
        type: 'close',
        socketId,
        code: 1000,
        reason: '',
      });
      this.cleanup(socketId);
      return;
    }

    try {
      socket.close((error: BusinessError) => {
        if (error) {
          this.emit(socketId, {
            type: 'error',
            socketId,
            message: error.message || 'WebSocket close error',
          });
        } else {
          this.emit(socketId, {
            type: 'close',
            socketId,
            code: 1000,
            reason: '',
          });
        }
        this.cleanup(socketId);
      });
    } catch (error) {
      this.emit(socketId, {
        type: 'error',
        socketId,
        message: this.getErrorMessage(error),
      });
      this.cleanup(socketId);
    }
  }

  public drainEvents(socketId: string, callback: DrainEventsCallback): void {
    const queue = this.events.get(socketId);
    if (!queue) {
      callback([]);
      return;
    }

    const drained = queue.slice();
    this.events.set(socketId, []);
    callback(drained);
  }

  private emit(socketId: string, event: NativeWebSocketEvent): void {
    let queue = this.events.get(socketId);
    if (!queue) {
      queue = [];
      this.events.set(socketId, queue);
    }
    queue.push(event);
  }

  private cleanup(socketId: string): void {
    this.sockets.delete(socketId);
  }

  private stringifyMessage(value: string | ArrayBuffer): string {
    if (typeof value === 'string') {
      return value;
    }
    return this.arrayBufferToBase64(value);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';

    for (let i = 0; i < bytes.length; i += 3) {
      const byte1 = bytes[i];
      const byte2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const byte3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const triplet = (byte1 << 16) | (byte2 << 8) | byte3;

      result += chars[(triplet >> 18) & 0x3f];
      result += chars[(triplet >> 12) & 0x3f];
      result += i + 1 < bytes.length ? chars[(triplet >> 6) & 0x3f] : '=';
      result += i + 2 < bytes.length ? chars[triplet & 0x3f] : '=';
    }

    return result;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'WebSocket error';
  }
}
