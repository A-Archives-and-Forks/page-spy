package com.example.lynx.modules;

import com.lynx.devtool.LynxInspectorConsoleDelegate;

public class PageSpyConsoleDelegate implements LynxInspectorConsoleDelegate {
  @Override
  public void onConsoleMessage(String msg) {
    PageSpyConsoleModule.enqueue(msg);
  }
}
