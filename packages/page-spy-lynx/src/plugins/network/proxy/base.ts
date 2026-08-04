import { NetworkProxyBase } from '@huolala-tech/page-spy-base/dist/network/base';
import socketStore from '../../../helpers/socket';

/** Lynx 网络代理基类，统一注入当前包的 socketStore。 */
export default class LynxNetworkProxyBase extends NetworkProxyBase {
  constructor() {
    super(socketStore);
  }
}
