export const joinQuery = (args: Record<string, unknown>) => {
  // 这里保留原始值，不额外 encode，调用方负责处理需要转义的字段。
  const arr: string[] = [];
  Object.entries(args).forEach(([k, v]) => {
    arr.push(`${k}=${v}`);
  });
  return arr.join("&");
};

/** Lynx 运行时可能暴露为词法全局变量，直接访问前需要先声明类型。 */
declare const lynx: Record<string, any> | undefined;
declare const NativeModules: Record<string, any> | undefined;
declare const SystemInfo: Record<string, any> | undefined;

/** 从 Lynx/JS 运行时的词法全局变量中安全读取指定能力。 */
const getLynxGlobalBinding = (
  key:
    | "lynx"
    | "NativeModules"
    | "SystemInfo"
    | "console"
    | "fetch"
    | "Request"
    | "Headers"
    | "Response"
    | "Blob"
    | "URL"
    | "XMLHttpRequest",
) => {
  try {
    if (key === "lynx" && typeof lynx !== "undefined") return lynx;
    if (key === "NativeModules" && typeof NativeModules !== "undefined") {
      return NativeModules;
    }
    if (key === "SystemInfo" && typeof SystemInfo !== "undefined") {
      return SystemInfo;
    }
    if (key === "console" && typeof console !== "undefined") return console;
    if (key === "fetch" && typeof fetch !== "undefined") return fetch;
    if (key === "Request" && typeof Request !== "undefined") return Request;
    if (key === "Headers" && typeof Headers !== "undefined") return Headers;
    if (key === "Response" && typeof Response !== "undefined") return Response;
    if (key === "Blob" && typeof Blob !== "undefined") return Blob;
    if (key === "URL" && typeof URL !== "undefined") return URL;
    if (key === "XMLHttpRequest" && typeof XMLHttpRequest !== "undefined") {
      return XMLHttpRequest;
    }
  } catch {
    // ignored
  }
  return undefined;
};

/** 将 Lynx 常用全局能力补齐到统一 globalObject，方便其他模块按同一入口读取。 */
const mergeLynxGlobalBindings = (globalObject: Record<string, any>) => {
  const keys = [
    "lynx",
    "NativeModules",
    "SystemInfo",
    "console",
    "fetch",
    "Request",
    "Headers",
    "Response",
    "Blob",
    "URL",
    "XMLHttpRequest",
  ] as const;

  keys.forEach((key) => {
    const binding = getLynxGlobalBinding(key);
    if (binding && !globalObject[key]) {
      globalObject[key] = binding;
    }
  });
};

// 某些平台没有完整 global 对象，允许业务方手动注入运行时全局对象。
let customGlobal: Record<string, any> = {};
export const setCustomGlobal = (global: Record<string, any>) => {
  customGlobal = global;
};

// 获取合并后的全局上下文，并补齐 Lynx 特有的全局能力。
export const getGlobal = () => {
  let foundGlobal: Record<string, any> = {};
  if (typeof globalThis === "object" && Object.keys(globalThis).length > 1) {
    foundGlobal = globalThis;
  } else if (
    typeof global === "object" &&
    typeof global !== "undefined" &&
    Object.keys(global).length > 1
  ) {
    foundGlobal = global;
  }
  if (customGlobal) {
    Object.assign(foundGlobal, customGlobal);
  }
  mergeLynxGlobalBindings(foundGlobal);
  return foundGlobal;
};