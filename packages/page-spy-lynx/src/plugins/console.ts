import type {
  SpyConsole,
  PageSpyPlugin,
  OnInitParams,
  SpyBase,
} from "@huolala-tech/page-spy-types";
import { getRandomId, psLog } from "@huolala-tech/page-spy-base/dist/utils";
import { atom } from "@huolala-tech/page-spy-base/dist/atom";
import { makeMessage } from "@huolala-tech/page-spy-base/dist/message";
import socketStore from "../helpers/socket";
import type { InitConfig } from "../config";
import { getGlobal } from "../utils";

type ConsoleTarget = Record<string, any>;
type ConsoleBinding = {
  target: ConsoleTarget;
  host?: Record<string, any>;
  key?: string;
};

/** 原生侧可直接调用的全局回调名。 */
const NATIVE_CONSOLE_GLOBAL = "__PAGE_SPY_LYNX_CONSOLE__";
const NATIVE_CONSOLE_EVENT = "page-spy-console";
const NATIVE_CONSOLE_MODULE = "PageSpyConsoleModule";
const NATIVE_CONSOLE_POLL_INTERVAL = 250;

type PageSpyConsoleNativeModule = {
  drainMessages(
    callback: (
      payload: string[] | { messages?: string[] } | string | null | undefined,
      ...rest: (string[] | { messages?: string[] } | string | null | undefined)[]
    ) => void,
  ): void;
};

/** 收集当前运行时中所有可能的 console 对象，避免只代理到其中一个宿主对象。 */
const getConsoleBindings = (): ConsoleBinding[] => {
  const globalObject = getGlobal();
  const bindings: ConsoleBinding[] = [];
  const addBinding = (target: unknown, host?: Record<string, any>, key?: string) => {
    if (!target || typeof target !== "object") return;
    if (bindings.some((item) => item.target === target)) return;
    bindings.push({
      target: target as ConsoleTarget,
      host,
      key,
    });
  };

  addBinding(globalObject.console, globalObject, "console");
  addBinding(globalObject.lynx?.console, globalObject.lynx, "console");
  if (typeof globalThis === "object") {
    addBinding(
      (globalThis as Record<string, any>).console,
      globalThis as Record<string, any>,
      "console",
    );
  }
  try {
    if (typeof console !== "undefined") {
      addBinding(console);
    }
  } catch {
    // ignored
  }

  return bindings;
};

/** 尽量以 defineProperty 写入 console 方法，失败时回退到普通赋值。 */
const setConsoleMethod = (
  consoleTarget: ConsoleTarget,
  method: SpyConsole.ProxyType,
  value: (...args: any[]) => void,
) => {
  try {
    Object.defineProperty(consoleTarget, method, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch {
    // Lynx iOS/Android 的 console 方法可能是宿主定义属性，defineProperty 可能失败。
  }

  if (consoleTarget[method] !== value) {
    try {
      consoleTarget[method] = value;
    } catch {
      // ignored
    }
  }

  return consoleTarget[method] === value;
};

/** 当宿主 console 无法直接改写时，创建一个继承原 console 的代理对象。 */
const createConsoleProxy = (originConsole: ConsoleTarget) => {
  try {
    return Object.create(originConsole) as ConsoleTarget;
  } catch {
    return {} as ConsoleTarget;
  }
};

/** 将原生侧 console level 统一映射到 PageSpy 支持的日志类型。 */
const getNativeConsoleLevel = (value: unknown): SpyConsole.ProxyType => {
  const level = String(value || "").toLowerCase();
  if (level === "error") return "error";
  if (level === "warn" || level === "warning") return "warn";
  if (level === "info") return "info";
  if (level === "debug") return "debug";
  return "log";
};

/** 格式化原生调试协议里的参数结构，尽量还原可读值。 */
const formatNativeConsoleArg = (value: any) => {
  if (!value || typeof value !== "object") return value;
  if ("value" in value) return value.value;
  if ("description" in value) return value.description;
  if ("unserializableValue" in value) return value.unserializableValue;
  if ("objectId" in value) return `[${value.subtype || value.type || "object"}]`;
  if ("type" in value) return `[${value.type}]`;
  return value;
};

/** 将原生侧传来的 console payload 解析为 PageSpy console 数据项。 */
const parseNativeConsolePayload = (payload: any): SpyConsole.DataItem | null => {
  let data = payload;
  if (Array.isArray(data)) {
    data = data[0];
  }
  if (data && typeof data === "object" && "detail" in data) {
    data = data.detail;
  }
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return {
        logType: "log",
        logs: [data],
        url: "",
      };
    }
  }

  if (!data || typeof data !== "object") return null;

  const args = Array.isArray(data.args) ? data.args : [data.message || data];
  return {
    logType: getNativeConsoleLevel(data.level || data.type || data.logType || data.method),
    logs: args.map(formatNativeConsoleArg),
    url: data.url || "",
  };
};

/** 统一原生模块返回的单条、数组或包装对象消息。 */
const normalizeNativeConsoleMessages = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.messages)) {
    return payload.messages;
  }
  if (payload == null) return [];
  return [payload];
};

/** 获取宿主注册的控制台消息原生模块。 */
const getNativeConsoleModule = (): PageSpyConsoleNativeModule | null => {
  const nativeModule = getGlobal().NativeModules?.[NATIVE_CONSOLE_MODULE];
  if (typeof nativeModule?.drainMessages === "function") {
    return nativeModule;
  }
  return null;
};

/** Console 插件：代理 JS console，并接收原生侧 console 日志后转发到 PageSpy。 */
export default class ConsolePlugin implements PageSpyPlugin {
  /** 插件名称。 */
  public name: string = "ConsolePlugin";

  /** 保存原始 console 方法，用于插件内部回显和 reset 恢复。 */
  public console: Record<string, any> = {};

  /** 已被代理的 console 目标列表及其原始方法。 */
  public consoleTargets: {
    target: ConsoleTarget;
    host?: Record<string, any>;
    key?: string;
    originHostValue?: ConsoleTarget;
    originals: Record<string, any>;
  }[] = [];

  /** 原生 console 桥回调引用，reset 时用于移除。 */
  public nativeConsoleHandler: ((payload: any, ...rest: any[]) => void) | null = null;

  /** 标记是否已通过 lynx.add 安装原生事件监听。 */
  public nativeConsoleEventInstalled = false;

  /** 轮询原生 console 模块的定时器。 */
  public nativeConsolePollTimer: ReturnType<typeof setTimeout> | null = null;

  /** 原生模块连续缺失次数，用于延迟打印告警。 */
  public nativeConsoleMissingCount = 0;

  /** 避免重复打印原生模块缺失告警。 */
  public nativeConsoleMissingWarned = false;

  public static hasInitd = false;

  /** 需要代理的 console 方法类型。 */
  public proxyTypes: SpyConsole.ProxyType[] = ["log", "info", "error", "warn", "debug"];

  public $pageSpyConfig: InitConfig | null = null;

  /** 插件初始化：注册远程 debug 指令并安装 console 代理。 */
  public async onInit({ config }: OnInitParams<InitConfig>) {
    if (ConsolePlugin.hasInitd) return;
    ConsolePlugin.hasInitd = true;

    socketStore.addListener("debug", ConsolePlugin.handleDebugger);

    this.$pageSpyConfig = config;
    this.init();
    this.initNativeConsoleBridge();
  }

  /** 代理所有可发现的 console 对象，并保留原始方法用于本地输出。 */
  public init() {
    const printLog = this.printLog.bind(this);
    const consoleBindings = getConsoleBindings();
    this.consoleTargets = consoleBindings.map((binding) => {
      const originals: Record<string, any> = {};
      this.proxyTypes.forEach((item) => {
        originals[item] = binding.target[item] || binding.target.log || (() => {});
      });
      return {
        ...binding,
        originHostValue: binding.host && binding.key ? binding.host[binding.key] : undefined,
        originals,
      };
    });

    this.proxyTypes.forEach((item) => {
      const primaryConsole = this.consoleTargets[0]?.originals;
      this.console[item] = primaryConsole?.[item] || (() => {});
    });

    this.consoleTargets.forEach((binding) => {
      let proxyTarget = binding.target;
      this.proxyTypes.forEach((item) => {
        // 代理方法只采集日志；是否回显由 sendLog 的 shouldPrint 控制。
        const proxy = function consoleProxy(...args: any[]) {
          printLog({
            logType: item,
            logs: args,
            url: "",
          });
        };
        const success = setConsoleMethod(proxyTarget, item, proxy);
        if (!success && binding.host && binding.key) {
          proxyTarget = createConsoleProxy(binding.target);
          try {
            binding.host[binding.key] = proxyTarget;
            binding.target = proxyTarget;
          } catch {
            // ignored
          }
          setConsoleMethod(proxyTarget, item, proxy);
        }
      });
    });
  }

  /** 恢复被代理的 console 方法和宿主 console 对象。 */
  public reset() {
    this.consoleTargets.forEach((binding) => {
      this.proxyTypes.forEach((item) => {
        if (binding.originals[item]) {
          setConsoleMethod(binding.target, item, binding.originals[item]);
        }
      });
      if (binding.host && binding.key && binding.originHostValue) {
        try {
          binding.host[binding.key] = binding.originHostValue;
        } catch {
          // ignored
        }
      }
    });
    this.consoleTargets = [];
    this.resetNativeConsoleBridge();
  }

  /** 插件重置入口，恢复代理并清理初始化标记。 */
  public onReset() {
    this.reset();
    ConsolePlugin.hasInitd = false;
  }

  /** 安装原生 console 桥：支持全局回调、lynx 事件和 NativeModule 轮询三种路径。 */
  public initNativeConsoleBridge() {
    const globalObject = getGlobal();
    const handler = (payload: any, ...rest: any[]) => {
      const nativePayload = rest.length > 0 ? [payload, ...rest] : payload;
      const data = parseNativeConsolePayload(nativePayload);
      if (data) {
        this.sendLog(data, false);
      }
    };

    this.nativeConsoleHandler = handler;
    globalObject[NATIVE_CONSOLE_GLOBAL] = handler;
    if (typeof globalThis === "object") {
      (globalThis as Record<string, any>)[NATIVE_CONSOLE_GLOBAL] = handler;
    }

    try {
      if (typeof globalObject.lynx?.add === "function") {
        globalObject.lynx.add(NATIVE_CONSOLE_EVENT, handler);
        this.nativeConsoleEventInstalled = true;
      }
    } catch {
      // ignored
    }

    this.startNativeConsolePolling();
  }

  /** 移除原生 console 桥并清理轮询状态。 */
  public resetNativeConsoleBridge() {
    const globalObject = getGlobal();
    if (this.nativeConsoleEventInstalled && this.nativeConsoleHandler) {
      try {
        globalObject.lynx?.remove?.(NATIVE_CONSOLE_EVENT, this.nativeConsoleHandler);
      } catch {
        // ignored
      }
    }
    if (globalObject[NATIVE_CONSOLE_GLOBAL] === this.nativeConsoleHandler) {
      delete globalObject[NATIVE_CONSOLE_GLOBAL];
    }
    if (
      typeof globalThis === "object" &&
      (globalThis as Record<string, any>)[NATIVE_CONSOLE_GLOBAL] === this.nativeConsoleHandler
    ) {
      delete (globalThis as Record<string, any>)[NATIVE_CONSOLE_GLOBAL];
    }
    this.nativeConsoleHandler = null;
    this.nativeConsoleEventInstalled = false;
    this.nativeConsoleMissingCount = 0;
    this.nativeConsoleMissingWarned = false;
    if (this.nativeConsolePollTimer) {
      clearTimeout(this.nativeConsolePollTimer);
      this.nativeConsolePollTimer = null;
    }
  }

  /** 轮询原生 console 模块，读取宿主侧缓存的日志消息。 */
  public startNativeConsolePolling() {
    if (this.nativeConsolePollTimer) return;

    const poll = () => {
      const nativeModule = getNativeConsoleModule();
      if (!nativeModule) {
        this.nativeConsoleMissingCount += 1;
        if (this.nativeConsoleMissingCount >= 4 && !this.nativeConsoleMissingWarned) {
          this.nativeConsoleMissingWarned = true;
          psLog.warn(
            "NativeModules.PageSpyConsoleModule is not available; native iOS/Android console messages require registering PageSpyConsoleModule and LynxInspectorConsoleDelegate",
          );
        }
        if (this.nativeConsoleHandler) {
          this.nativeConsolePollTimer = setTimeout(poll, NATIVE_CONSOLE_POLL_INTERVAL);
        } else {
          this.nativeConsolePollTimer = null;
        }
        return;
      }
      this.nativeConsoleMissingCount = 0;

      nativeModule.drainMessages((payload, ...rest) => {
        const messages = rest.length
          ? normalizeNativeConsoleMessages([payload, ...rest])
          : normalizeNativeConsoleMessages(payload);
        messages.forEach((message) => {
          const data = parseNativeConsolePayload(message);
          if (data) {
            this.sendLog(data, false);
          }
        });

        if (this.nativeConsoleHandler) {
          this.nativeConsolePollTimer = setTimeout(poll, NATIVE_CONSOLE_POLL_INTERVAL);
        } else {
          this.nativeConsolePollTimer = null;
        }
      });
    };

    this.nativeConsolePollTimer = setTimeout(poll, 0);
  }

  // 执行远端调试面板传来的表达式，并把原始代码和执行结果回传。
  public static handleDebugger(
    { source }: SpyBase.InteractiveEvent<string>,
    reply: (data: any) => void,
  ) {
    const { type, data } = source;
    if (type === "debug") {
      const originMsg = makeMessage("console", {
        logType: "debug-origin",
        logs: [
          {
            id: getRandomId(),
            type: "debug-origin",
            value: data,
          },
        ],
      });
      reply(originMsg);
      try {
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
        const result = new Function(`return ${data}`)();
        const evalMsg = makeMessage("console", {
          logType: "debug-eval",
          logs: [atom.transformToAtom(result)],
        });
        reply(evalMsg);
      } catch (err) {
        const errMsg = makeMessage("console", {
          logType: "error",
          logs: [
            {
              type: "error",
              value: (err as Error).stack,
            },
          ],
        });
        reply(errMsg);
      }
    }
  }

  public printLog(data: SpyConsole.DataItem) {
    this.sendLog(data, true);
  }

  /** 发送 console 日志到 PageSpy，并按配置决定是否公开原始值或序列化值。 */
  public sendLog(data: SpyConsole.DataItem, shouldPrint: boolean) {
    if (data.logs && data.logs.length) {
      const processor = this.$pageSpyConfig?.dataProcessor?.console;
      if (processor) {
        this.reset();
        const processedByUser = processor(data);
        this.init();

        if (processedByUser === false) return;
      }

      if (shouldPrint) {
        const print = this.console[data.logType] || this.console.log;
        print?.(...data.logs);
      }
      const atomLog = makeMessage("console", {
        ...data,
        time: Date.now(),
        logs: data.logs.map((log) => {
          return atom.transformToAtom(log, false);
        }),
      });
      socketStore.broadcastMessage(atomLog);

      if (!this.$pageSpyConfig?.serializeData) {
        socketStore.dispatchEvent("public-data", atomLog);
      } else {
        const serializeLog = {
          ...atomLog,
          data: {
            ...atomLog.data,
            logs: data.logs.map((log) => {
              return atom.transformToAtom(log, true);
            }),
          },
        };
        socketStore.dispatchEvent("public-data", serializeLog);
      }
    }
  }
}