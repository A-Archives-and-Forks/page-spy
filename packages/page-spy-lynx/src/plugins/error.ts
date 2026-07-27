import { atom, makeMessage, formatErrorObj } from "@huolala-tech/page-spy-base";
import type { SpyConsole, PageSpyPlugin, OnInitParams } from "@huolala-tech/page-spy-types/index";
import socketStore from "../helpers/socket";
import { InitConfig } from "../config";
import { getGlobal } from "../utils";

type GlobalErrorHandler = (error: Error) => void;
type GlobalRejectionHandler = (event: { reason?: any }) => void;

type ErrorCapableGlobal = Record<string, any> & {
  onerror?: GlobalErrorHandler | null;
  onunhandledrejection?: GlobalRejectionHandler | null;
  addEventListener?: (type: string, handler: GlobalErrorHandler | GlobalRejectionHandler) => void;
  removeEventListener?: (
    type: string,
    handler: GlobalErrorHandler | GlobalRejectionHandler,
  ) => void;
};

/** Error 插件：捕获未处理异常和 Promise rejection，并复用 console 通道上报。 */
export default class ErrorPlugin implements PageSpyPlugin {
  /** 插件名称。 */
  public name = "ErrorPlugin";

  public static hasInitd = false;

  /** 原始全局 onerror，reset 时恢复并在捕获后继续调用。 */
  public originOnError: GlobalErrorHandler | null = null;

  /** 原始全局 onunhandledrejection，reset 时恢复并在捕获后继续调用。 */
  public originOnUnhandledRejection: GlobalRejectionHandler | null = null;

  public $pageSpyConfig: InitConfig | null = null;

  private errorHandlerRef: GlobalErrorHandler | null = null;

  private rejectionHandlerRef: GlobalRejectionHandler | null = null;

  /** 初始化全局错误监听。 */
  public onInit({ config }: OnInitParams<InitConfig>) {
    if (ErrorPlugin.hasInitd) return;
    ErrorPlugin.hasInitd = true;

    this.$pageSpyConfig = config;
    this.onUncaughtError();
    this.onUnhandledRejectionError();
  }

  /** 捕获运行时未处理异常，优先使用 addEventListener，兼容 onerror。 */
  public onUncaughtError() {
    const g = getGlobal() as ErrorCapableGlobal;
    const handler: GlobalErrorHandler = (error) => {
      this.errorHandler(error);
      this.originOnError?.(error);
    };

    this.errorHandlerRef = handler;
    if (typeof g.addEventListener === "function") {
      g.addEventListener("error", handler);
      return;
    }

    if ("onerror" in g) {
      this.originOnError = g.onerror || null;
      g.onerror = handler;
    }
  }

  /** 捕获未处理 Promise rejection，兼容事件监听和全局回调两种能力。 */
  public onUnhandledRejectionError() {
    const g = getGlobal() as ErrorCapableGlobal;
    const handler: GlobalRejectionHandler = (event) => {
      this.errorHandler(event?.reason || event);
      this.originOnUnhandledRejection?.(event);
    };

    this.rejectionHandlerRef = handler;
    if (typeof g.addEventListener === "function") {
      g.addEventListener("unhandledrejection", handler);
      return;
    }

    if ("onunhandledrejection" in g) {
      this.originOnUnhandledRejection = g.onunhandledrejection || null;
      g.onunhandledrejection = handler;
    }
  }

  /** 将不同形态的错误对象整理成 PageSpy console error 消息。 */
  public errorHandler(error: Error | string | any) {
    if (!ErrorPlugin.hasInitd) {
      return;
    }
    if (error?.message || error?.stack) {
      const errorDetail = formatErrorObj(error);
      this.sendMessage(error.stack || error.message, errorDetail);
    } else if (typeof error === "string") {
      this.sendMessage(error, null);
    } else {
      const defaultMessage =
        "[PageSpy] An unknown error occurred and no message or stack trace available";
      this.sendMessage(defaultMessage, error);
    }
  }

  /** 移除全局监听并恢复宿主原有错误处理器。 */
  public onReset() {
    if (!ErrorPlugin.hasInitd) {
      return;
    }

    const g = getGlobal() as ErrorCapableGlobal;
    if (typeof g.removeEventListener === "function") {
      if (this.errorHandlerRef) {
        g.removeEventListener("error", this.errorHandlerRef);
      }
      if (this.rejectionHandlerRef) {
        g.removeEventListener("unhandledrejection", this.rejectionHandlerRef);
      }
    }

    if ("onerror" in g) {
      g.onerror = this.originOnError;
    }
    if ("onunhandledrejection" in g) {
      g.onunhandledrejection = this.originOnUnhandledRejection;
    }

    this.errorHandlerRef = null;
    this.rejectionHandlerRef = null;
    ErrorPlugin.hasInitd = false;
  }

  /** 上报错误消息，允许用户 dataProcessor 拦截或加工。 */
  public sendMessage(data: any, errorDetail: SpyConsole.DataItem["errorDetail"] | null) {
    const error = {
      logType: "error",
      logs: [data],
      time: Date.now(),
      url: "",
      errorDetail,
    };
    const processedByUser = this.$pageSpyConfig?.dataProcessor?.console?.(
      error as SpyConsole.DataItem,
    );
    if (processedByUser === false) return;

    error.logs = error.logs.map((l) => atom.transformToAtom(l));
    const message = makeMessage("console", error);
    socketStore.dispatchEvent("public-data", message);
    socketStore.broadcastMessage(message);
  }
}