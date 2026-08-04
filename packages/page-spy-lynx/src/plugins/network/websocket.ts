/* eslint-disable @typescript-eslint/brace-style */
import {
  getRandomId,
  RequestItem,
  ReqReadyState,
  NetworkProxyBase,
  PAGE_SPY_WS_ENDPOINT,
  WebSocketMessage,
} from '@huolala-tech/page-spy-base';
import { OnInitParams, PageSpyPlugin } from '@huolala-tech/page-spy-types';
import WebNetworkProxyBase from './proxy/base';
import { InitConfig } from '../../config';

/** 判断 WebSocket 构造器是否可继承和实例化。 */
const isConstructableWebSocket = (WebSocketCtor: any) => {
  if (typeof WebSocketCtor !== 'function') {
    return false;
  }
  try {
    Reflect.construct(String, [], WebSocketCtor);
    return true;
  } catch (e) {
    return false;
  }
};

/** WebSocket 网络代理：继承原始 WebSocket，采集连接和消息事件。 */
export default class WebSocketPlugin
  extends WebNetworkProxyBase
  implements PageSpyPlugin
{
  /** 插件名称。 */
  public name = 'WebSocketPlugin';

  public static hasInitd = false;

  /** 原始 WebSocket 构造器，reset 时恢复。 */
  public originWebSocket: typeof WebSocket | null = null;

  /** 初始化 WebSocket 代理，并同步网络 dataProcessor。 */
  public onInit({ config }: OnInitParams<InitConfig>) {
    if (WebSocketPlugin.hasInitd) return;
    WebSocketPlugin.hasInitd = true;
    NetworkProxyBase.dataProcessor = config.dataProcessor.network;

    this.initProxyHandler();
  }

  /** 安装 WebSocket 构造器代理，PageSpy 自身连接会被跳过。 */
  public initProxyHandler() {
    const OriginWebSocket = globalThis.WebSocket;
    if (!isConstructableWebSocket(OriginWebSocket)) {
      return;
    }
    this.originWebSocket = OriginWebSocket;

    const plugin = this;
    /** 代理构造器：保留原 WebSocket 行为，只旁路记录连接和消息。 */
    class PageSpyWebSocketProxy extends OriginWebSocket {
      private _requestId: string | null = null;

      private _req: RequestItem | null = null;

      private _lastEventId = 0;

      constructor(uri: string, ...args: any[]) {
        super(uri, ...args);
        // 跳过 PageSpy SDK 自己连接调试房间的 WebSocket，避免递归上报。
        if (uri.includes(PAGE_SPY_WS_ENDPOINT)) return;

        this._requestId = getRandomId();
        plugin.createRequest(this._requestId);
        this._req = plugin.getRequest(this._requestId)!;

        // 设置 WebSocket 握手的基础请求信息。
        this._req.url = uri.toString();
        this._req.method = 'GET';
        this._req.requestType = 'websocket';
        this._req.requestHeader = [
          ['Upgrade', 'websocket'],
          ['Connection', 'Upgrade'],
          ['Sec-WebSocket-Version', '13'],
        ];

        const protocols = args[0];
        if (protocols) {
          const protocolsStr = Array.isArray(protocols)
            ? protocols.join(', ')
            : protocols;
          this._req.requestHeader.push([
            'Sec-WebSocket-Protocol',
            protocolsStr,
          ]);
        }
        this._req.readyState = ReqReadyState.UNSENT;
        this._req.startTime = Date.now();
        this._req.response = null;
        this.setupEventListeners();
      }

      /** 监听 WebSocket 生命周期和消息事件，并转成网络面板记录。 */
      private setupEventListeners() {
        this.addEventListener('open', () => {
          if (!this._req || !this._requestId) return;
          this._req.readyState = ReqReadyState.OPENED;
          this._req.status = 101; // WebSocket 握手成功：Switching Protocols。
          this._req.statusText = 'Switching Protocols';
          this._req.endTime = Date.now();
          this._req.costTime = this._req.endTime - this._req.startTime;
          this._req.responseHeader = [
            ['Upgrade', 'websocket'],
            ['Connection', 'Upgrade'],
          ];
          plugin.sendRequestItem(this._requestId, this._req);
        });

        // 监听消息接收事件。
        this.addEventListener('message', (event) => {
          if (!this._req || !this._requestId) return;

          const message: WebSocketMessage = {
            type: 'receive',
            data: event.data,
            timestamp: Date.now(),
          };

          this._req.readyState = ReqReadyState.DONE;
          this._req.status = 200;
          this._req.statusText = 'OK';
          this._req.response = message;
          this._req.endTime = Date.now();
          this._req.costTime = this._req.endTime - this._req.startTime;
          this._req.lastEventId = String(this._lastEventId++);

          plugin.sendRequestItem(this._requestId, this._req);
        });

        // 监听错误事件。
        this.addEventListener('error', () => {
          if (!this._req || !this._requestId) return;
          this._req.readyState = ReqReadyState.DONE;
          this._req.status = 400;
          this._req.statusText = 'WebSocket Error';
          this._req.endTime = Date.now();
          this._req.costTime = this._req.endTime - this._req.startTime;

          plugin.sendRequestItem(this._requestId, this._req);
        });

        // 监听连接关闭事件。
        this.addEventListener('close', (event) => {
          if (!this._req || !this._requestId) return;
          this._req.readyState = ReqReadyState.DONE;
          this._req.status = Number(event.code);
          this._req.statusText = event.reason || 'Connection Closed';
          this._req.endTime = Date.now();
          this._req.costTime = this._req.endTime - this._req.startTime;

          plugin.sendRequestItem(this._requestId, this._req);
        });
      }

      // 代理 send 方法，记录业务侧发出的 WebSocket 消息。
      send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
        if (this._req && this._requestId) {
          const message: WebSocketMessage = {
            type: 'send',
            data: this.formatSendData(data),
            timestamp: Date.now(),
          };

          this._req.readyState = ReqReadyState.DONE;
          this._req.status = 200;
          this._req.statusText = 'OK';
          this._req.response = message;
          this._req.lastEventId = String(this._lastEventId++);
          this._req.endTime = Date.now();
          this._req.costTime = this._req.endTime - this._req.startTime;
          plugin.sendRequestItem(this._requestId, this._req);
        }
        // 调用原始 send 方法，保证业务 WebSocket 行为不变。
        super.send(data);
      }

      /** 将不同类型的发送数据转换为可展示的字符串。 */
      private formatSendData(
        data: string | ArrayBuffer | ArrayBufferView | Blob,
      ): string {
        if (typeof data === 'string') {
          return data;
        }
        if (data instanceof Blob) {
          return '[Blob data]';
        }
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          return '[Binary data]';
        }
        return String(data);
      }
    }

    globalThis.WebSocket = PageSpyWebSocketProxy as any;
  }

  /** 恢复原始 WebSocket 构造器。 */
  public onReset() {
    if (this.originWebSocket) {
      globalThis.WebSocket = this.originWebSocket;
    }
    this.originWebSocket = null;
    WebSocketPlugin.hasInitd = false;
  }
}
