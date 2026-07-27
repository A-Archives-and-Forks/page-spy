import type { SpyClient } from "@huolala-tech/page-spy-types";
import { getGlobal } from "./utils";

type LynxGlobal = {
  __globalProps?: Record<string, any>;
  getSystemInfoSync?: () => Record<string, any>;
  getSystemInfo?: () => Record<string, any>;
  getNativeApp?: () => Record<string, any>;
  [key: string]: any;
};

type LynxSystemInfo = {
  engineVersion?: string;
  lynxSdkVersion?: string;
  osVersion?: string;
  pixelHeight?: number;
  pixelWidth?: number;
  pixelRatio?: number;
  platform?: "Android" | "iOS" | "macOS" | "windows" | "headless" | "web" | string;
  runtimeType?: "v8" | "jsc" | "quickjs" | string;
  [key: string]: any;
};

declare const SystemInfo: LynxSystemInfo | undefined;

/** 获取带 Lynx 能力声明的全局对象。 */
const getGlobalObject = () => {
  return getGlobal() as typeof globalThis & {
    lynx?: LynxGlobal;
    NativeModules?: Record<string, any>;
    SystemInfo?: LynxSystemInfo;
  };
};

/** 读取 lynx 全局对象，非 Lynx 环境返回 null。 */
const getLynxGlobal = (): LynxGlobal | null => {
  return getGlobalObject().lynx || null;
};

/** 读取原生模块集合，供系统信息兜底查询使用。 */
const getNativeModules = () => {
  return getGlobalObject().NativeModules;
};

/** 优先读取 Lynx 注入的 SystemInfo 全局变量，失败时回退到统一全局对象。 */
const getSystemInfoGlobal = () => {
  try {
    if (typeof SystemInfo !== "undefined") return SystemInfo;
  } catch {
    // ignored
  }
  return getGlobalObject().SystemInfo || null;
};

/** 从多个候选值中选出第一个有效字符串，避免上报空字段。 */
const pickString = (...values: any[]) => {
  const value = values.find((item) => typeof item === "string" && item);
  return value || "unknown";
};

/** 将不同平台返回的系统名称归一化为 PageSpy 识别的 OS 枚举。 */
const normalizeOS = (value: any): SpyClient.OS => {
  const text = String(value || "").toLowerCase();
  if (text.includes("android")) return "android";
  if (text.includes("ios") || text.includes("iphone")) return "ios";
  if (text.includes("ipad")) return "ipad";
  if (text.includes("mac")) return "mac";
  if (text.includes("web")) return "web" as SpyClient.OS;
  if (text.includes("windows") || text.includes("win")) return "windows";
  if (text.includes("linux")) return "linux";
  if (text.includes("harmony")) return "harmony";
  return "unknown";
};

/** 汇总 Lynx 全局属性和系统 API 信息，作为客户端识别的原始数据。 */
export const getLynxSystemInfo = () => {
  const lynx = getLynxGlobal();
  const nativeModules = getNativeModules();
  const systemInfo = getSystemInfoGlobal();
  let apiInfo: Record<string, any> = {};

  try {
    apiInfo =
      systemInfo ||
      lynx?.getSystemInfoSync?.() ||
      lynx?.getSystemInfo?.() ||
      nativeModules?.SystemInfo?.getSystemInfoSync?.() ||
      nativeModules?.SystemInfo?.getSystemInfo?.() ||
      {};
  } catch {
    apiInfo = {};
  }

  const globalProps = lynx?.__globalProps || {};
  return {
    ...globalProps,
    ...apiInfo,
  };
};

/** 生成 PageSpy 客户端信息，用于房间名称、系统面板和调试端展示。 */
export const getLynxClientInfo = (): SpyClient.ClientInfo => {
  const rawInfo = getLynxSystemInfo();
  const osSource =
    rawInfo.osType || rawInfo.platform || rawInfo.os || rawInfo.system || rawInfo.devicePlatform;
  return {
    osType: normalizeOS(osSource),
    osVersion: pickString(
      rawInfo.osVersion,
      rawInfo.systemVersion,
      rawInfo.system,
      rawInfo.version,
    ),
    browserType: "lynx" as SpyClient.Browser,
    browserVersion: pickString(
      rawInfo.lynxVersion,
      rawInfo.engineVersion,
      rawInfo.lynxSdkVersion,
      rawInfo.sdkVersion,
    ),
    framework: "react-lynx" as SpyClient.Framework,
    sdk: "react-lynx" as SpyClient.SDKType,
    sdkVersion: PKG_VERSION,
  };
};