// eslint-disable no-case-declarations
import type { OnInitParams, PageSpyPlugin } from "@huolala-tech/page-spy-types";
import { NetworkProxyBase } from "@huolala-tech/page-spy-base/dist/network/base";
import XhrProxy from "./proxy/xhr-proxy";
import FetchProxy from "./proxy/fetch-proxy";
import { InitConfig } from "../../config";
import { getGlobal } from "../../utils";

/** 判断当前 Lynx 运行时是否有 fetch 或 lynx.fetch 能力。 */
const hasFetchCapability = () => {
  const globalObject = getGlobal();
  return typeof globalObject.fetch === "function" || typeof globalObject.lynx?.fetch === "function";
};

/** 判断当前 Lynx 运行时是否有可代理的 XMLHttpRequest 能力。 */
const hasXhrCapability = () => {
  const XHR = getGlobal().XMLHttpRequest as typeof XMLHttpRequest | undefined;
  return (
    typeof XHR === "function" &&
    !!XHR.prototype?.open &&
    !!XHR.prototype?.send &&
    !!XHR.prototype?.setRequestHeader
  );
};

/** Network 插件：根据运行时能力安装 fetch/XHR 代理并上报请求流水。 */
export default class NetworkPlugin implements PageSpyPlugin {
  /** 插件名称。 */
  public name = "NetworkPlugin";

  /** XHR 代理实例；运行时不支持 XHR 时为空。 */
  public xhrProxy: XhrProxy | null = null;

  /** fetch 代理实例；运行时不支持 fetch 时为空。 */
  public fetchProxy: FetchProxy | null = null;

  public static hasInitd = false;

  /** 初始化网络代理，并把用户配置的数据处理器同步给基础代理类。 */
  public onInit({ config }: OnInitParams<InitConfig>) {
    if (NetworkPlugin.hasInitd) return;
    NetworkPlugin.hasInitd = true;
    NetworkProxyBase.dataProcessor = config.dataProcessor.network;

    if (hasFetchCapability()) {
      this.fetchProxy = new FetchProxy();
    }
    if (hasXhrCapability()) {
      this.xhrProxy = new XhrProxy();
    }
  }

  /** 恢复原始 fetch/XHR 并清理代理实例。 */
  public onReset() {
    this.fetchProxy?.reset();
    this.xhrProxy?.reset();
    this.fetchProxy = null;
    this.xhrProxy = null;
    NetworkPlugin.hasInitd = false;
  }
}