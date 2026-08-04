import { makeMessage } from '@huolala-tech/page-spy-base';
import type {
  PageSpyPlugin,
  OnInitParams,
  SpyBase,
} from '@huolala-tech/page-spy-types';
import type {
  DataItem,
  GetTypeDataItem,
} from '@huolala-tech/page-spy-types/lib/storage';
import { getGlobal } from '../utils';

/** 原生本地存储模块类型定义（Lynx NativeModules 中的 NativeLocalStorageModule） */
type NativeLocalStorageModule = {
  /** 设置存储项 */
  setStorageItem(key: string, value: string): void;
  /** 获取存储项，通过回调返回值 */
  getStorageItem(key: string, callback: (value: string) => void): void;
  /** 获取所有存储项，通过回调返回值（可选） */
  getAllStorageItems?(
    callback: (
      value:
        | Record<string, string>
        | Array<{ name: string; value: string }>
        | string,
    ) => void,
  ): void;
  /** 删除指定存储项（可选，不支持时通过设置为空字符串替代） */
  removeStorageItem?(key: string): void;
  /** 清空所有存储项 */
  clearStorage(): void;
};

/** Web 端 Storage 接口类型定义（兼容 localStorage） */
type WebStorageLike = {
  /** 存储项数量 */
  length?: number;
  /** 设置存储项 */
  setItem(key: string, value: string): void;
  /** 获取存储项 */
  getItem(key: string): string | null;
  /** 根据索引获取存储项的 key（可选） */
  key?(index: number): string | null;
  /** 删除指定存储项（可选，不支持时通过设置为空字符串替代） */
  removeItem?(key: string): void;
  /** 清空所有存储项 */
  clear(): void;
};

/** 内存存储，作为原生存储和 Web 存储都不可用时的降级方案 */
const memoryStorage = new Map<string, string>();

/**
 * 输出存储操作失败的警告日志
 * @param action - 失败的操作类型（如 get、set、clear 等）
 * @param error - 错误对象
 */
const warnStorageFallback = (action: string, error: unknown) => {
  const globalConsole = getGlobal().console;
  if (typeof globalConsole?.warn === 'function') {
    globalConsole.warn(`[page-spy-react-lynx] storage ${action} failed`, error);
  }
};

/**
 * 规范化存储值，将空字符串、undefined 等统一转为 null
 * @param value - 原始存储值
 * @returns 规范化后的值，空值返回 null
 */
const normalizeStorageValue = (value: string | null | undefined) => {
  return value || null;
};

/**
 * 获取原生存储模块实例
 * @returns NativeLocalStorageModule 实例，不可用时返回 null
 */
const getNativeStorage = (): NativeLocalStorageModule | null => {
  const nativeModule = getGlobal().NativeModules?.NativeLocalStorageModule;
  // 校验原生模块是否具备核心方法
  if (
    nativeModule &&
    typeof nativeModule.setStorageItem === 'function' &&
    typeof nativeModule.getStorageItem === 'function' &&
    typeof nativeModule.clearStorage === 'function'
  ) {
    return nativeModule;
  }
  return null;
};

/**
 * 获取 Web 端存储实例（localStorage）
 * @returns WebStorageLike 实例，不可用时返回 null
 */
const getWebStorage = (): WebStorageLike | null => {
  const globalObject = getGlobal();
  let webStorage: WebStorageLike | null = null;

  try {
    // 尝试从全局对象或 globalThis 获取 localStorage
    webStorage =
      globalObject.localStorage ||
      (typeof globalThis === 'object'
        ? (globalThis as Record<string, any>).localStorage
        : null);
  } catch (error) {
    warnStorageFallback('detect', error);
    return null;
  }

  // 校验 Web 存储是否具备核心方法
  if (
    webStorage &&
    typeof webStorage.setItem === 'function' &&
    typeof webStorage.getItem === 'function' &&
    typeof webStorage.clear === 'function'
  ) {
    return webStorage;
  }
  return null;
};

/**
 * 从内存存储中获取指定 key 的值
 * @param key - 存储项的键名
 * @returns 存储值，不存在时返回 null
 */
const getMemoryStorageItem = (key: string) => {
  return memoryStorage.has(key) ? memoryStorage.get(key) || null : null;
};

/**
 * 获取存储项
 * 优先级：原生存储 > Web 存储 > 内存存储
 * @param key - 存储项的键名
 * @returns 存储值，不存在时返回 null
 */
export const getStorageItem = async (key: string): Promise<string | null> => {
  // 优先尝试原生存储
  const nativeStorage = getNativeStorage();
  if (nativeStorage) {
    try {
      return await new Promise<string | null>((resolve) => {
        nativeStorage.getStorageItem(key, (value) => {
          const normalizedValue = normalizeStorageValue(value);
          if (normalizedValue === null) {
            memoryStorage.delete(key);
          } else {
            memoryStorage.set(key, normalizedValue);
          }
          resolve(normalizedValue);
        });
      });
    } catch (error) {
      warnStorageFallback('get', error);
      // 原生存储失败，降级到内存存储
      return getMemoryStorageItem(key);
    }
  }

  // 其次尝试 Web 存储
  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      return normalizeStorageValue(webStorage.getItem(key));
    } catch (error) {
      warnStorageFallback('get', error);
      // Web 存储失败，降级到内存存储
      return getMemoryStorageItem(key);
    }
  }

  // 最终降级到内存存储
  return getMemoryStorageItem(key);
};

/**
 * 设置存储项
 * 优先级：原生存储 > Web 存储 > 内存存储
 * @param key - 存储项的键名
 * @param value - 存储项的值
 */
export const setStorageItem = (key: string, value: string): void => {
  // 优先尝试原生存储
  const nativeStorage = getNativeStorage();
  if (nativeStorage) {
    try {
      nativeStorage.setStorageItem(key, value);
      memoryStorage.set(key, value);
      return;
    } catch (error) {
      warnStorageFallback('set', error);
      // 原生存储失败，降级到内存存储
      memoryStorage.set(key, value);
      return;
    }
  }

  // 其次尝试 Web 存储
  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      webStorage.setItem(key, value);
      memoryStorage.set(key, value);
      return;
    } catch (error) {
      warnStorageFallback('set', error);
      // Web 存储失败，降级到内存存储
      memoryStorage.set(key, value);
      return;
    }
  }

  // 最终降级到内存存储
  memoryStorage.set(key, value);
};

/**
 * 清空所有存储项
 * 同时清空持久化存储和内存存储
 */
export const clearStorage = (): void => {
  // 优先尝试原生存储
  const nativeStorage = getNativeStorage();
  if (nativeStorage) {
    try {
      nativeStorage.clearStorage();
      memoryStorage.clear();
      return;
    } catch (error) {
      warnStorageFallback('clear', error);
      memoryStorage.clear();
      return;
    }
  }

  // 其次尝试 Web 存储
  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      webStorage.clear();
      memoryStorage.clear();
      return;
    } catch (error) {
      warnStorageFallback('clear', error);
      memoryStorage.clear();
      return;
    }
  }

  // 最终降级到内存存储
  memoryStorage.clear();
};

/**
 * 删除指定存储项
 * 若原生/Web 存储不支持 removeItem，则通过设置为空字符串来模拟删除
 * @param key - 存储项的键名
 */
export const removeStorageItem = (key: string): void => {
  // 优先尝试原生存储
  const nativeStorage = getNativeStorage();
  if (nativeStorage) {
    try {
      if (typeof nativeStorage.removeStorageItem === 'function') {
        nativeStorage.removeStorageItem(key);
      } else {
        // 不支持 removeStorageItem 时，通过设置为空字符串模拟删除
        nativeStorage.setStorageItem(key, '');
      }
      memoryStorage.delete(key);
      return;
    } catch (error) {
      warnStorageFallback('remove', error);
      memoryStorage.delete(key);
      return;
    }
  }

  // 其次尝试 Web 存储
  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      if (typeof webStorage.removeItem === 'function') {
        webStorage.removeItem(key);
      } else {
        // 不支持 removeItem 时，通过设置为空字符串模拟删除
        webStorage.setItem(key, '');
      }
      memoryStorage.delete(key);
      return;
    } catch (error) {
      warnStorageFallback('remove', error);
      memoryStorage.delete(key);
      return;
    }
  }

  // 最终降级到内存存储
  memoryStorage.delete(key);
};

/**
 * 从 DataItem 中提取存储键名
 * @param data - 存储数据项
 * @returns 键名，无法提取时返回空字符串
 */
const getStorageKey = (data: DataItem) => {
  if ('name' in data && data.name) {
    return data.name;
  }
  if ('data' in data && data.data[0]?.name) {
    return data.data[0].name;
  }
  return '';
};

/**
 * 将不同格式的存储数据统一规范化为 { name, value } 数组
 * 支持对象、数组和 JSON 字符串三种输入格式
 * @param value - 原始存储数据，可能是对象、数组或 JSON 字符串
 * @returns 规范化后的存储项数组
 */
const normalizeStorageEntries = (
  value:
    | Record<string, string>
    | Array<{ name: string; value: string }>
    | string,
): Array<{ name: string; value: string }> => {
  // 如果是字符串，先尝试 JSON 解析后递归处理
  if (typeof value === 'string') {
    try {
      return normalizeStorageEntries(JSON.parse(value));
    } catch (error) {
      warnStorageFallback('list', error);
      return [];
    }
  }

  // 如果是数组，过滤无效项并确保 value 为字符串
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && item.name)
      .map(({ name, value: val }) => ({
        name,
        value: String(val),
      }));
  }

  // 如果是对象，转换为 { name, value } 数组
  return Object.entries(value || {}).map(([name, val]) => ({
    name,
    value: String(val),
  }));
};

/**
 * 获取所有存储项的值
 * 优先级：原生存储 > Web 存储 > 内存存储
 * @returns 所有存储项的 { name, value } 数组
 */
const getAllStorageValues = async () => {
  // 优先尝试原生存储
  const nativeStorage = getNativeStorage();
  if (nativeStorage && typeof nativeStorage.getAllStorageItems === 'function') {
    try {
      return await new Promise<Array<{ name: string; value: string }>>(
        (resolve) => {
          nativeStorage.getAllStorageItems!((value) => {
            resolve(normalizeStorageEntries(value));
          });
        },
      );
    } catch (error) {
      warnStorageFallback('list', error);
    }
  }

  // 其次尝试 Web 存储
  const webStorage = getWebStorage();
  if (
    webStorage &&
    typeof webStorage.key === 'function' &&
    typeof webStorage.length === 'number'
  ) {
    try {
      const entries: Array<{ name: string; value: string }> = [];
      for (let i = 0; i < webStorage.length; i += 1) {
        const name = webStorage.key(i);
        if (!name) continue;
        const value = webStorage.getItem(name);
        if (value !== null) {
          entries.push({ name, value });
        }
      }
      return entries;
    } catch (error) {
      warnStorageFallback('list', error);
    }
  }

  // 最终降级到内存存储
  return Array.from(memoryStorage.entries()).map(([name, value]) => ({
    name,
    value,
  }));
};

/**
 * 根据数据项获取存储值
 * 若未指定 key 则返回所有存储项，否则返回指定 key 的值
 * @param data - 存储数据项
 * @returns 存储项的 { name, value } 数组
 */
const getStorageValues = async (data: DataItem) => {
  const key = getStorageKey(data);
  // 未指定 key 时，返回所有存储项
  if (!key) {
    return getAllStorageValues();
  }

  // 指定 key 时，返回对应存储项
  const value = await getStorageItem(key);
  return value === null
    ? []
    : [
        {
          name: key,
          value,
        },
      ];
};

/** 存储操作集合，对外暴露的统一接口 */
export const storage = {
  getStorageItem,
  setStorageItem,
  removeStorageItem,
  clearStorage,
};

/**
 * Storage 插件
 * 实现 PageSpyPlugin 接口，通过 WebSocket 监听远程存储操作指令，
 * 并在本地执行对应的存储增删改查操作
 */
export default class StoragePlugin implements PageSpyPlugin {
  /** 插件名称 */
  public name = 'StoragePlugin';

  /** 标记插件是否已初始化，防止重复初始化 */
  public static hasInitd = false;

  /** 存储操作集合 */
  public storage = storage;

  /** WebSocket 连接存储实例，用于监听和响应远程指令 */
  private socketStore: OnInitParams<any>['socketStore'] | null = null;

  /**
   * 处理远程存储操作事件
   * 支持 set、remove、clear、get 四种操作
   * @param event - 远程交互事件
   * @param reply - 回复函数，用于将操作结果返回给远程端
   */
  private onStorage = async (
    event: SpyBase.InteractiveEvent<DataItem>,
    reply: (data: unknown) => void,
  ) => {
    const { data } = event.source;

    // 设置存储项
    if (data.action === 'set') {
      setStorageItem(data.name, data.value);
      reply(makeMessage('storage', data));
      return;
    }

    // 删除存储项
    if (data.action === 'remove') {
      removeStorageItem(data.name);
      reply(makeMessage('storage', data));
      return;
    }

    // 清空所有存储项
    if (data.action === 'clear') {
      clearStorage();
      reply(makeMessage('storage', data));
      return;
    }

    // 获取存储项
    if (data.action === 'get') {
      const values = await getStorageValues(data);
      const response: GetTypeDataItem = {
        type: data.type,
        action: 'get',
        data: values,
      };
      reply(makeMessage('storage', response));
    }
  };

  /**
   * 插件初始化
   * 注册 WebSocket 监听器，监听远程存储操作指令
   * @param socketStore - WebSocket 连接存储实例
   */
  public onInit({ socketStore }: OnInitParams<any>) {
    if (StoragePlugin.hasInitd) return;
    StoragePlugin.hasInitd = true;
    this.socketStore = socketStore;
    (socketStore.addListener as any)('storage', this.onStorage);
  }

  /**
   * 插件重置
   * 移除 WebSocket 监听器，清理状态
   */
  public onReset() {
    (this.socketStore?.removeListener as any)?.('storage', this.onStorage);
    this.socketStore = null;
    StoragePlugin.hasInitd = false;
  }
}
