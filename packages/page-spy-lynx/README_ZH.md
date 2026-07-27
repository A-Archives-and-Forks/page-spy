[npm-image]: https://img.shields.io/npm/v/@huolala-tech/page-spy-react-lynx?logo=npm&label=version
[npm-url]: https://www.npmjs.com/package/@huolala-tech/page-spy-react-lynx
[minified-image]: https://img.shields.io/bundlephobia/min/@huolala-tech/page-spy-react-lynx
[minified-url]: https://unpkg.com/browse/@huolala-tech/page-spy-react-lynx/dist/esm/index.min.js

[English](./README.md) | 中文

# `@huolala-tech/page-spy-react-lynx`

[![SDK version][npm-image]][npm-url]
[![SDK size][minified-image]][minified-url]

> 这个 SDK 用于调试 Lynx APP。

Lynx 不提供浏览器里的 `window` 和 `document` 对象。本 SDK 不依赖 DOM API，内置插件会先检查 Lynx 运行时是否提供对应全局能力，可用才启用。

## 使用

建议在后台专属代码里初始化 PageSpy，例如只被后台逻辑引入的入口模块，或 Lynx 的 `useEffect` 中。

```ts
import PageSpy from '@huolala-tech/page-spy-react-lynx';

const pageSpy = new PageSpy({
  api: 'example.com',
});
```

## `InitConfig`

除了 `api` 参数必须明确指定，其他参数沿用 PageSpy SDK 的通用配置。

```ts
const pageSpy = new PageSpy(config);

interface InitConfig {
  api: string;
  project?: string;
  title?: string;
  enableSSL?: boolean | null;
  disabledPlugins?: (InternalPlugins | string)[];
}

type InternalPlugins =
  | 'ConsolePlugin'
  | 'ErrorPlugin'
  | 'NetworkPlugin'
  | 'SystemPlugin'
  | 'WebSocketPlugin';
```

## 内置插件

- `ConsolePlugin`：代理 `console.log/info/error/warn/debug`。
- `SystemPlugin`：上报 PageSpy client 信息和可获取的 Lynx 系统信息。
- `NetworkPlugin`：优先代理 `fetch`；仅在运行时暴露兼容 `XMLHttpRequest` 时代理 XHR。
- `WebSocketPlugin`：仅在 `globalThis.WebSocket` 可被构造时代理 WebSocket。
- `ErrorPlugin`：仅在运行时暴露全局错误或 unhandled rejection hook 时监听。

可以通过 `disabledPlugins` 关闭任意内置插件。

## 原生 WebSocket 模块

PageSpy 自身连接服务端时会优先使用 Lynx `NativeModules.LynxNativeWebSocketModule`。真实 Lynx Native 运行时的宿主 App 应在初始化 PageSpy 前注册该原生模块；web 预览运行时会回退到可构造的 `globalThis.WebSocket`。如果两种能力都不存在，SDK 会抛出明确错误。

JavaScript 侧接口约定如下：

```ts
declare let NativeModules: {
  LynxNativeWebSocketModule: {
    connect(socketId: string, url: string): void;
    send(socketId: string, data: string): void;
    close(socketId: string): void;
    drainEvents(
      socketId: string,
      callback: (events: NativeWebSocketEvent[]) => void,
    ): void;
  };
};

type NativeWebSocketEvent =
  | { type: 'open'; socketId: string }
  | { type: 'message'; socketId: string; data: string }
  | { type: 'close'; socketId: string; code?: number; reason?: string }
  | { type: 'error'; socketId: string; message?: string };
```

原生实现应把 `open/message/close/error` 事件写入队列，并通过 `drainEvents` 返回给 JS；不要依赖同一个 NativeModule callback 被多次 invoke。

原生示例代码位于 `native-examples/android`、`native-examples/ios` 和 `native-examples/harmony`。

Android 注册示例：

```java
LynxEnv.inst().registerModule(
  "LynxNativeWebSocketModule",
  LynxNativeWebSocketModule.class
);
```

Android 示例使用 OkHttp 的 `WebSocketListener`；宿主 App 需要引入 OkHttp，或改造成项目已有的 WebSocket 客户端。

iOS 注册示例：

```objc
[globalConfig registerModule:LynxNativeWebSocketModule.class];
```

Harmony 注册示例：

```ts
import { LynxNativeWebSocketModule } from './module/LynxNativeWebSocketModule';

this.modules.set('LynxNativeWebSocketModule', {
  moduleClass: LynxNativeWebSocketModule,
});
```

Harmony 示例使用 NetworkKit 的 WebSocket API；如果宿主 Harmony SDK 使用不同的 WebSocket 导入路径，只需要替换 import，保持 NativeModule 契约不变。

`WebSocketPlugin` 与该模块是两件事。它仍然只在 Lynx 运行时提供可构造的 `globalThis.WebSocket` 时代理业务 WebSocket 流量。

## 原生 Console 模块

Lynx native 运行时的 `console` 会进入 Lynx DevTool inspector 管道，不能保证能通过 JS 覆盖 `console.log` 拦截。PageSpy 会自动检测 `NativeModules.PageSpyConsoleModule`，并通过 `drainMessages` 拉取 `LynxInspectorConsoleDelegate.onConsoleMessage(msg)` 收到的 JSON 字符串。

JavaScript 侧接口约定如下：

```ts
declare let NativeModules: {
  PageSpyConsoleModule: {
    drainMessages(
      callback: (messages: string[]) => void,
    ): void;
  };
};
```

原生示例代码位于 `native-examples/android`、`native-examples/ios` 和 `native-examples/harmony`：

- `PageSpyConsoleModule`：保存 console 消息队列，并通过 `drainMessages` 返回给 JS。
- `PageSpyConsoleDelegate`：实现 `LynxInspectorConsoleDelegate`，在 `onConsoleMessage(msg)` 中写入队列。

Android 注册与接入示例：

```java
LynxEnv.inst().registerModule(
  "PageSpyConsoleModule",
  PageSpyConsoleModule.class
);

LynxBaseInspectorOwner owner = lynxView.getBaseInspectorOwner();
if (owner != null) {
  owner.setLynxInspectorConsoleDelegate(new PageSpyConsoleDelegate());
}
```

iOS 注册与接入示例：

```objc
[globalConfig registerModule:PageSpyConsoleModule.class];

id<LynxBaseInspectorOwner> owner = lynxView.baseInspectorOwner;
if (owner) {
  [PageSpyConsoleDelegate installWithInspectorOwner:owner];
}
```

Harmony 注册与接入示例：

```ts
import { LynxView, LynxContext } from '@lynx/lynx';
import { PageSpyConsoleModule } from './module/PageSpyConsoleModule';
import { PageSpyConsoleDelegate } from './module/PageSpyConsoleDelegate';

this.modules.set('PageSpyConsoleModule', {
  moduleClass: PageSpyConsoleModule,
});

LynxView({
  onCreate: (context: LynxContext) => {
    const owner = context.getBaseInspectorOwner();
    if (owner) {
      PageSpyConsoleDelegate.installWithInspectorOwner(owner);
    }
  },
});
```

如果宿主 App 没有接入该 delegate，PageSpy 仍会在 Web/可覆写 JS console 环境下工作，但 iOS/Android/Harmony native 上可能捕获不到 console；这是 Lynx native console 管道的限制。

排查提示：如果 iOS 日志里只看到 `LynxNativeWebSocketModule.drainEvents`，但没有看到 `PageSpyConsoleModule.drainMessages`，说明当前 LynxView 没有暴露 `NativeModules.PageSpyConsoleModule`。只注册 WebSocket 模块只能保证 PageSpy 连接可用，不能捕获 native console。
