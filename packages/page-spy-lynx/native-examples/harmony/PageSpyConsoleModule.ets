import { LynxContext, LynxModule } from '@lynx/lynx';

type DrainMessagesCallback = (messages: string[]) => void;

export class PageSpyConsoleModule extends LynxModule {
  private static messages: string[] = [];

  constructor(context: LynxContext, param?: Object) {
    super(context, param);
  }

  public static enqueueConsoleMessage(message: string): void {
    if (!message) {
      return;
    }
    PageSpyConsoleModule.messages.push(message);
  }

  public drainMessages(callback: DrainMessagesCallback): void {
    const drained = PageSpyConsoleModule.messages.slice();
    PageSpyConsoleModule.messages = [];
    callback(drained);
  }
}
