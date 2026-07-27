[npm-image]: https://img.shields.io/npm/v/@huolala-tech/page-spy-react-lynx?logo=npm&label=version
[npm-url]: https://www.npmjs.com/package/@huolala-tech/page-spy-react-lynx
[minified-image]: https://img.shields.io/bundlephobia/min/@huolala-tech/page-spy-react-lynx
[minified-url]: https://unpkg.com/browse/@huolala-tech/page-spy-react-lynx/dist/esm/index.min.js

[English](./README.md) | [Chinese](./README_ZH.md)

# `@huolala-tech/page-spy-react-lynx`

[![SDK version][npm-image]][npm-url]
[![SDK size][minified-image]][minified-url]

> PageSpy SDK for Lynx apps.

Lynx does not provide browser `window` or `document` objects. This SDK does not depend on DOM APIs, and its built-in plugins enable themselves only when the Lynx runtime exposes the corresponding global capability.

## Usage

Initialize PageSpy from background-only code, such as an entry module imported only by background logic or inside a Lynx `useEffect`.

```ts
import PageSpy from '@huolala-tech/page-spy-react-lynx';

const pageSpy = new PageSpy({
  api: 'example.com',
});
```

## `InitConfig`

The `api` option is required. Other options follow the shared PageSpy SDK config.

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

## Built-in plugins

- `ConsolePlugin`: proxies `console.log/info/error/warn/debug`.
- `SystemPlugin`: reports PageSpy client and available Lynx system information.
- `NetworkPlugin`: proxies `fetch` first, and proxies `XMLHttpRequest` only when the runtime exposes a compatible implementation.
- `WebSocketPlugin`: proxies WebSocket traffic only when `globalThis.WebSocket` is constructable.
- `ErrorPlugin`: listens to global error and unhandled rejection hooks when the runtime exposes them.

Use `disabledPlugins` to turn off any built-in plugin.

## Native WebSocket module

PageSpy prefers Lynx `NativeModules.LynxNativeWebSocketModule` for its own WebSocket connection. Host apps should register this native module before initializing PageSpy in real Lynx native runtimes. In web preview runtimes, the SDK falls back to a constructable `globalThis.WebSocket`; if neither capability exists, initialization throws a clear error.

The JavaScript contract is:

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

Native implementations should enqueue `open/message/close/error` events and return them through `drainEvents`. Do not depend on invoking the same NativeModule callback multiple times.

Native examples are included in `native-examples/android`, `native-examples/ios`, and `native-examples/harmony`.

Android registration:

```java
LynxEnv.inst().registerModule(
  "LynxNativeWebSocketModule",
  LynxNativeWebSocketModule.class
);
```

The Android example uses OkHttp's `WebSocketListener`; add OkHttp to the host app or adapt the sample to the app's existing WebSocket client.

iOS registration:

```objc
[globalConfig registerModule:LynxNativeWebSocketModule.class];
```

Harmony registration:

```ts
import { LynxNativeWebSocketModule } from './module/LynxNativeWebSocketModule';

this.modules.set('LynxNativeWebSocketModule', {
  moduleClass: LynxNativeWebSocketModule,
});
```

The Harmony example uses NetworkKit's WebSocket API. If your Harmony SDK uses a different WebSocket import path, adapt only the import and keep the NativeModule contract unchanged.

`WebSocketPlugin` is separate from this module. It still proxies app WebSocket traffic only when the Lynx runtime exposes a constructable `globalThis.WebSocket`.

## Native Console module

In Lynx native runtimes, `console` messages are routed through the Lynx DevTool inspector pipeline and cannot be reliably intercepted by overwriting `console.log` in JavaScript. PageSpy automatically detects `NativeModules.PageSpyConsoleModule` and polls `drainMessages` for JSON strings received by `LynxInspectorConsoleDelegate.onConsoleMessage(msg)`.

The JavaScript contract is:

```ts
declare let NativeModules: {
  PageSpyConsoleModule: {
    drainMessages(
      callback: (messages: string[]) => void,
    ): void;
  };
};
```

Native examples are included in `native-examples/android`, `native-examples/ios`, and `native-examples/harmony`:

- `PageSpyConsoleModule`: stores console messages and returns them to JS via `drainMessages`.
- `PageSpyConsoleDelegate`: implements `LynxInspectorConsoleDelegate` and queues messages from `onConsoleMessage(msg)`.

Android registration and setup:

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

iOS registration and setup:

```objc
[globalConfig registerModule:PageSpyConsoleModule.class];

id<LynxBaseInspectorOwner> owner = lynxView.baseInspectorOwner;
if (owner) {
  [PageSpyConsoleDelegate installWithInspectorOwner:owner];
}
```

Harmony registration and setup:

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

Without this delegate integration, PageSpy still works in Web or JS-overwritable console environments, but iOS/Android/Harmony native console messages may not be captured because they stay inside Lynx's native inspector pipeline.

Troubleshooting: if iOS logs only show `LynxNativeWebSocketModule.drainEvents` and never show `PageSpyConsoleModule.drainMessages`, the current LynxView does not expose `NativeModules.PageSpyConsoleModule`. Registering only the WebSocket module makes the PageSpy connection work, but it does not capture native console messages.
