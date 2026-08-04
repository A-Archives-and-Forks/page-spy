import { getAuthSecret, isArray, isClass, psLog } from "@huolala-tech/page-spy-base/dist/utils";
import { Client } from "@huolala-tech/page-spy-base/dist/client";
import type {
  PageSpyPlugin,
  PageSpyPluginLifecycle,
  PluginOrder,
  PageSpyPluginLifecycleArgs,
} from "@huolala-tech/page-spy-types";

import ConsolePlugin from "./plugins/console";
import ErrorPlugin from "./plugins/error";
import NetworkPlugin from "./plugins/network";
import SystemPlugin from "./plugins/system";
import StoragePlugin from "./plugins/storage";
import WebSocketPlugin from "./plugins/network/websocket";
import { getLynxClientInfo, getLynxSystemInfo } from "./platform";
import { getGlobal } from "./utils";
export {
  clearStorage,
  getStorageItem,
  removeStorageItem,
  setStorageItem,
  storage,
} from "./plugins/storage";

import socketStore from "./helpers/socket";
import Request from "./api";

// eslint-disable-next-line import/order
import { Config, InitConfig } from "./config";

type UpdateConfig = {
  title?: string;
  project?: string;
};

type PageSpyRuntimeState = {
  instance: PageSpy | null;
  initPromise: Promise<void> | null;
};

/** 将单例状态挂到全局对象，避免模块重复加载时产生多个 PageSpy 实例。 */
const RUNTIME_STATE_KEY = "__PAGE_SPY_REACT_LYNX_STATE__";

/** 获取或初始化 PageSpy 在当前 Lynx 运行时中的单例状态。 */
const getPageSpyRuntimeState = (): PageSpyRuntimeState => {
  const globalObject = getGlobal();
  if (!globalObject[RUNTIME_STATE_KEY]) {
    globalObject[RUNTIME_STATE_KEY] = {
      instance: null,
      initPromise: null,
    } as PageSpyRuntimeState;
  }
  return globalObject[RUNTIME_STATE_KEY] as PageSpyRuntimeState;
};

class PageSpy {
  /** 当前 SDK 版本，由构建产物注入。 */
  version = PKG_VERSION;

  /** 按执行顺序分组的插件注册表。 */
  static plugins: Record<PluginOrder | "normal", PageSpyPlugin[]> = {
    pre: [],
    normal: [],
    post: [],
  };

  /** 展开后的插件执行队列：pre -> normal -> post。 */
  static get pluginsWithOrder() {
    return [...PageSpy.plugins.pre, ...PageSpy.plugins.normal, ...PageSpy.plugins.post];
  }

  static client: Client;

  /** 创建房间和生成 WebSocket 地址的请求实例。 */
  request: Request | null = null;

  // 系统信息展示名：<os>-<browser>:<browserVersion>
  name = "";

  // PageSpy 房间号
  address = "";

  // 完整的 WebSocket 房间连接地址
  roomUrl = "";

  socketStore = socketStore;

  config = new Config();

  static get instance() {
    return getPageSpyRuntimeState().instance;
  }

  static set instance(value: PageSpy | null) {
    const state = getPageSpyRuntimeState();
    state.instance = value;
    if (!value) {
      state.initPromise = null;
    }
  }

  /** 根据当前 Lynx 系统信息刷新客户端标识。 */
  static refreshClient() {
    PageSpy.client = new Client(getLynxClientInfo(), getLynxSystemInfo());
  }

  /** 注册插件实例，并根据 enforce 字段放入对应执行队列。 */
  static registerPlugin(plugin: PageSpyPlugin) {
    if (!plugin) {
      return;
    }
    if (isClass(plugin)) {
      psLog.error("PageSpy.registerPlugin() expect to pass an instance, not a class");
      return;
    }
    if (!plugin.name) {
      psLog.error(`The ${plugin.constructor.name} plugin should provide a "name" property`);
      return;
    }
    const isExist = PageSpy.pluginsWithOrder.some((i) => i.name === plugin.name);
    if (isExist) {
      psLog.info(
        `The ${plugin.name} has registered. Consider the following reasons:
      - Duplicate register one same plugin;
      - Plugin's "name" conflict with others, you can print all registered plugins by "PageSpy.plugins";`,
      );
      return;
    }
    const currentPluginSet = PageSpy.plugins[plugin.enforce || "normal"];
    currentPluginSet.push(plugin);
  }

  constructor(init: InitConfig) {
    if (PageSpy.instance) {
      psLog.warn("Cannot initialize PageSpy multiple times");
      // eslint-disable-next-line no-constructor-return
      return PageSpy.instance;
    }

    const config = this.config.mergeConfig(init);
    PageSpy.refreshClient();

    // 创建请求实例时会校验 api 基础地址是否可用。
    this.request = new Request(this.config, PageSpy.client);
    this.updateConfiguration();
    PageSpy.instance = this;

    PageSpy.client.plugins = PageSpy.pluginsWithOrder.map((plugin) => plugin.name);
    this.triggerPlugins("onInit", {
      socketStore,
      config,
      client: PageSpy.client,
    });

    getPageSpyRuntimeState().initPromise = this.init();
  }

  /** 将配置同步到 socketStore，供所有插件和消息通道共享。 */
  updateConfiguration() {
    const { messageCapacity, useSecret } = this.config.get();
    if (useSecret === true) {
      const secret = getAuthSecret();
      this.config.set("secret", secret);
      psLog.log(`Room Secret: ${secret}`);
    }

    socketStore.connectable = true;
    socketStore.getPageSpyConfig = () => this.config.get();
    socketStore.getClient = () => PageSpy.client;
    socketStore.messageCapacity = messageCapacity;
  }

  triggerPlugins<T extends PageSpyPluginLifecycle>(
    lifecycle: T,
    ...args: PageSpyPluginLifecycleArgs<T>
  ) {
    const { disabledPlugins } = this.config.get();
    PageSpy.pluginsWithOrder.forEach((plugin) => {
      if (
        isArray(disabledPlugins) &&
        disabledPlugins.length &&
        disabledPlugins.includes(plugin.name)
      ) {
        return;
      }
      (plugin[lifecycle] as any)?.apply(plugin, args);
    });
  }

  /** 初始化 PageSpy 房间连接，复用正在进行的初始化 Promise 防止并发建房。 */
  async init() {
    const state = getPageSpyRuntimeState();
    if (state.initPromise) {
      return state.initPromise;
    }

    state.initPromise = this.createNewConnection()
      .then(() => {
        psLog.log("Plugins inited");
      })
      .catch((err) => {
        state.initPromise = null;
        throw err;
      });
    return state.initPromise;
  }

  /** 重置所有插件并关闭 WebSocket 连接。 */
  abort() {
    this.triggerPlugins("onReset");
    socketStore.close();
    PageSpy.instance = null;
  }

  /** 请求服务端创建调试房间，并初始化 WebSocket 通道。 */
  async createNewConnection() {
    if (this.roomUrl) {
      return;
    }
    if (!this.request) {
      psLog.error("Cannot get the Request");
      return;
    }
    const roomInfo = await this.request.createRoom();
    this.name = roomInfo.name;
    this.address = roomInfo.address;
    this.roomUrl = roomInfo.roomUrl;
    socketStore.init(roomInfo.roomUrl);
  }

  /** 更新房间展示信息，并通知远端调试面板刷新。 */
  updateRoomInfo(obj: UpdateConfig) {
    if (!obj) return;

    const { project, title } = obj;
    if (project) {
      this.config.set("project", String(project));
    }
    if (title) {
      this.config.set("title", String(title));
    }

    socketStore.updateRoomInfo();
  }

  /** 获取可在浏览器中打开的 PageSpy 调试面板链接。 */
  getDebugLink() {
    const config = this.config.get();
    let link = `${config.enableSSL === false ? "http://" : "https://"}${config.api}/#/devtools?address=${encodeURIComponent(
      this.address,
    )}`;
    if (config.useSecret) {
      link += `&secret=${config.secret}`;
    }
    return link;
  }

  /** Lynx 场景暂无内置面板，返回房间号供宿主侧展示。 */
  async showPanel() {
    if (this.address) {
      return Promise.reject(`PageSpy 房间号：${this.address.slice(0, 4)}`);
    } else {
      return Promise.reject("PageSpy 房间号不存在");
    }
  }
}

PageSpy.client = new Client(getLynxClientInfo(), getLynxSystemInfo());

const INTERNAL_PLUGINS = [
  new ConsolePlugin(),
  new ErrorPlugin(),
  new NetworkPlugin(),
  new SystemPlugin(),
  new StoragePlugin(),
  new WebSocketPlugin(),
];

INTERNAL_PLUGINS.forEach((p) => {
  PageSpy.registerPlugin(p);
});

export default PageSpy;