package com.example.lynx.modules;

import android.content.Context;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import org.json.JSONArray;
import org.json.JSONObject;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class LynxNativeWebSocketModule extends LynxModule {
  private final OkHttpClient client = new OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .pingInterval(15, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build();
  private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();
  private final Map<String, List<Map<String, Object>>> events = new ConcurrentHashMap<>();

  public LynxNativeWebSocketModule(Context context) {
    super(context);
  }

  @LynxMethod
  public void connect(String socketId, String url) {
    events.put(socketId, Collections.synchronizedList(new ArrayList<>()));

    Request request = new Request.Builder().url(url).build();
    WebSocket socket = client.newWebSocket(
      request,
      new WebSocketListener() {
        @Override
        public void onOpen(WebSocket webSocket, Response response) {
          sockets.put(socketId, webSocket);
          emit(socketId, "open", null, null, null);
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
          emit(socketId, "message", text, null, null);
        }

        @Override
        public void onClosing(WebSocket webSocket, int code, String reason) {
          webSocket.close(code, reason);
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason) {
          emit(socketId, "close", null, code, reason);
          cleanup(socketId);
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable t, Response response) {
          emit(socketId, "error", null, null, t.getMessage());
          cleanup(socketId);
        }
      }
    );
    sockets.put(socketId, socket);
  }

  @LynxMethod
  public void send(String socketId, String data) {
    WebSocket socket = sockets.get(socketId);
    if (socket != null) {
      socket.send(data);
    }
  }

  @LynxMethod
  public void close(String socketId) {
    WebSocket socket = sockets.get(socketId);
    if (socket != null) {
      socket.close(1000, "");
      return;
    }
    emit(socketId, "close", null, 1000, "");
    cleanup(socketId);
  }

  @LynxMethod
  public void drainEvents(String socketId, Callback callback) {
    List<Map<String, Object>> queue = events.get(socketId);
    if (queue == null) {
      callback.invoke(createDrainResultJson(new ArrayList<Map<String, Object>>()));
      return;
    }

    List<Map<String, Object>> drained;
    synchronized (queue) {
      drained = new ArrayList<>(queue);
      queue.clear();
    }
    callback.invoke(createDrainResultJson(drained));
  }

  private String createDrainResultJson(List<Map<String, Object>> drained) {
    JSONObject result = new JSONObject();
    JSONArray eventArray = new JSONArray();
    for (Map<String, Object> event : drained) {
      eventArray.put(new JSONObject(event));
    }
    try {
      result.put("events", eventArray);
    } catch (Exception e) {
      return "{\"events\":[]}";
    }
    return result.toString();
  }

  private void emit(
    String socketId,
    String type,
    String data,
    Integer code,
    String messageOrReason
  ) {
    Map<String, Object> event = new HashMap<>();
    event.put("socketId", socketId);
    event.put("type", type);
    if (data != null) {
      event.put("data", data);
    }
    if (code != null) {
      event.put("code", code);
    }
    if ("error".equals(type)) {
      event.put("message", messageOrReason == null ? "WebSocket error" : messageOrReason);
    } else if (messageOrReason != null) {
      event.put("reason", messageOrReason);
    }

    List<Map<String, Object>> queue = events.get(socketId);
    if (queue != null) {
      queue.add(event);
    }
  }

  private void cleanup(String socketId) {
    sockets.remove(socketId);
  }

}
