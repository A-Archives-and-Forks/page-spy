package com.example.lynx.modules;

import android.content.Context;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class PageSpyConsoleModule extends LynxModule {
  private static final List<String> messages = Collections.synchronizedList(new ArrayList<>());

  public PageSpyConsoleModule(Context context) {
    super(context);
  }

  public static void enqueue(String message) {
    if (message != null) {
      messages.add(message);
    }
  }

  @LynxMethod
  public void drainMessages(Callback callback) {
    List<String> drained;
    synchronized (messages) {
      drained = new ArrayList<>(messages);
      messages.clear();
    }

    callback.invoke(drained);
  }
}
