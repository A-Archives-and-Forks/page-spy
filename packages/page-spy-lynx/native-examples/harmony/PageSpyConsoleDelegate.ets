import {
  LynxBaseInspectorOwner,
  LynxInspectorConsoleDelegate,
} from '@lynx/lynx';
import { PageSpyConsoleModule } from './PageSpyConsoleModule';

export class PageSpyConsoleDelegate implements LynxInspectorConsoleDelegate {
  private static installedDelegates: PageSpyConsoleDelegate[] = [];

  private owner: WeakRef<LynxBaseInspectorOwner>;

  constructor(owner: LynxBaseInspectorOwner) {
    this.owner = new WeakRef(owner);
  }

  public static installWithInspectorOwner(
    owner: LynxBaseInspectorOwner,
  ): PageSpyConsoleDelegate {
    const delegate = new PageSpyConsoleDelegate(owner);
    owner.setLynxInspectorConsoleDelegate(delegate);
    PageSpyConsoleDelegate.installedDelegates.push(delegate);
    return delegate;
  }

  public onConsoleMessage(msg: string): void {
    const owner = this.owner.deref();
    if (!owner) {
      return;
    }
    PageSpyConsoleModule.enqueueConsoleMessage(msg);
  }
}
