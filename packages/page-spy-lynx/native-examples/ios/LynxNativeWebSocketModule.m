#import "LynxNativeWebSocketModule.h"

typedef void (^LynxNativeWebSocketDrainCallback)(NSArray<NSDictionary *> *events);

@interface LynxNativeWebSocketConnection : NSObject

@property(nonatomic, copy) NSString *socketId;
@property(nonatomic, strong) NSURLSessionWebSocketTask *task;

@end

@implementation LynxNativeWebSocketConnection
@end

@interface LynxNativeWebSocketModule () <NSURLSessionWebSocketDelegate>

@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSMutableDictionary<NSString *, LynxNativeWebSocketConnection *> *connections;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSString *> *taskIds;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableArray<NSDictionary *> *> *events;

@end

@implementation LynxNativeWebSocketModule

+ (NSString *)name {
  return @"LynxNativeWebSocketModule";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"connect" : NSStringFromSelector(@selector(connect:url:)),
    @"send" : NSStringFromSelector(@selector(send:data:)),
    @"close" : NSStringFromSelector(@selector(close:)),
    @"drainEvents" : NSStringFromSelector(@selector(drainEvents:callback:)),
  };
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _connections = [NSMutableDictionary dictionary];
    _taskIds = [NSMutableDictionary dictionary];
    _events = [NSMutableDictionary dictionary];
    _session = [NSURLSession sessionWithConfiguration:NSURLSessionConfiguration.defaultSessionConfiguration
                                             delegate:self
                                        delegateQueue:nil];
  }
  return self;
}

- (void)connect:(NSString *)socketId
            url:(NSString *)url {
  @synchronized(self) {
    self.events[socketId] = [NSMutableArray array];
  }

  NSURL *requestURL = [NSURL URLWithString:url];
  if (!requestURL) {
    [self emitSocketId:socketId type:@"error" data:nil code:nil text:@"Invalid WebSocket URL"];
    return;
  }

  NSURLSessionWebSocketTask *task = [self.session webSocketTaskWithURL:requestURL];
  LynxNativeWebSocketConnection *connection = [[LynxNativeWebSocketConnection alloc] init];
  connection.socketId = socketId;
  connection.task = task;

  @synchronized(self) {
    self.connections[socketId] = connection;
    self.taskIds[@(task.taskIdentifier)] = socketId;
  }

  [task resume];
  [self receiveNextMessageForSocketId:socketId];
}

- (void)send:(NSString *)socketId data:(NSString *)data {
  LynxNativeWebSocketConnection *connection = [self connectionForSocketId:socketId];
  if (!connection) {
    return;
  }

  NSURLSessionWebSocketMessage *message = [[NSURLSessionWebSocketMessage alloc] initWithString:data];
  [connection.task sendMessage:message
             completionHandler:^(NSError *_Nullable error) {
               if (error) {
                 [self emitSocketId:socketId type:@"error" data:nil code:nil text:error.localizedDescription];
                 [self cleanupSocketId:socketId];
               }
             }];
}

- (void)close:(NSString *)socketId {
  LynxNativeWebSocketConnection *connection = [self connectionForSocketId:socketId];
  if (!connection) {
    [self emitSocketId:socketId type:@"close" data:nil code:@1000 text:@""];
    [self cleanupSocketId:socketId];
    return;
  }

  [connection.task cancelWithCloseCode:NSURLSessionWebSocketCloseCodeNormalClosure reason:nil];
  [self emitSocketId:socketId type:@"close" data:nil code:@1000 text:@""];
  [self cleanupSocketId:socketId];
}

- (void)drainEvents:(NSString *)socketId callback:(LynxNativeWebSocketDrainCallback)callback {
  NSArray<NSDictionary *> *drained = @[];
  @synchronized(self) {
    NSMutableArray<NSDictionary *> *queue = self.events[socketId];
    if (queue) {
      drained = [queue copy];
      [queue removeAllObjects];
    }
  }
  callback(drained);

  if ([self hasTerminalEvent:drained]) {
    @synchronized(self) {
      [self.events removeObjectForKey:socketId];
    }
  }
}

- (void)receiveNextMessageForSocketId:(NSString *)socketId {
  LynxNativeWebSocketConnection *connection = [self connectionForSocketId:socketId];
  if (!connection) {
    return;
  }

  [connection.task receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *_Nullable message,
                                                        NSError *_Nullable error) {
    if (error) {
      [self emitSocketId:socketId type:@"error" data:nil code:nil text:error.localizedDescription];
      [self cleanupSocketId:socketId];
      return;
    }

    if (message.type == NSURLSessionWebSocketMessageTypeString) {
      [self emitSocketId:socketId type:@"message" data:message.string code:nil text:nil];
    } else if (message.data) {
      NSString *text = [[NSString alloc] initWithData:message.data encoding:NSUTF8StringEncoding];
      [self emitSocketId:socketId
                    type:@"message"
                    data:text ?: [message.data base64EncodedStringWithOptions:0]
                    code:nil
                    text:nil];
    }

    [self receiveNextMessageForSocketId:socketId];
  }];
}

- (void)URLSession:(NSURLSession *)session
          webSocketTask:(NSURLSessionWebSocketTask *)webSocketTask
    didOpenWithProtocol:(NSString *_Nullable)protocol {
  NSString *socketId = [self socketIdForTask:webSocketTask];
  if (socketId) {
    [self emitSocketId:socketId type:@"open" data:nil code:nil text:nil];
  }
}

- (void)URLSession:(NSURLSession *)session
          webSocketTask:(NSURLSessionWebSocketTask *)webSocketTask
       didCloseWithCode:(NSURLSessionWebSocketCloseCode)closeCode
                 reason:(NSData *_Nullable)reason {
  NSString *socketId = [self socketIdForTask:webSocketTask];
  if (!socketId) {
    return;
  }

  NSString *reasonText = reason ? [[NSString alloc] initWithData:reason encoding:NSUTF8StringEncoding] : @"";
  [self emitSocketId:socketId type:@"close" data:nil code:@(closeCode) text:reasonText ?: @""];
  [self cleanupSocketId:socketId];
}

- (void)URLSession:(NSURLSession *)session
                    task:(NSURLSessionTask *)task
    didCompleteWithError:(NSError *_Nullable)error {
  if (!error) {
    return;
  }

  NSString *socketId = [self socketIdForTaskIdentifier:task.taskIdentifier];
  if (!socketId) {
    return;
  }

  [self emitSocketId:socketId type:@"error" data:nil code:nil text:error.localizedDescription];
  [self cleanupSocketId:socketId];
}

- (LynxNativeWebSocketConnection *_Nullable)connectionForSocketId:(NSString *)socketId {
  @synchronized(self) {
    return self.connections[socketId];
  }
}

- (NSString *_Nullable)socketIdForTask:(NSURLSessionTask *)task {
  return [self socketIdForTaskIdentifier:task.taskIdentifier];
}

- (NSString *_Nullable)socketIdForTaskIdentifier:(NSUInteger)taskIdentifier {
  @synchronized(self) {
    return self.taskIds[@(taskIdentifier)];
  }
}

- (void)emitSocketId:(NSString *)socketId
                type:(NSString *)type
                data:(NSString *_Nullable)data
                code:(NSNumber *_Nullable)code
                text:(NSString *_Nullable)text {
  NSMutableDictionary *event = [@{
    @"type" : type,
    @"socketId" : socketId,
  } mutableCopy];
  if (data) {
    event[@"data"] = data;
  }
  if (code) {
    event[@"code"] = code;
  }
  if ([type isEqualToString:@"error"]) {
    event[@"message"] = text ?: @"WebSocket error";
  } else if (text) {
    event[@"reason"] = text;
  }

  @synchronized(self) {
    NSMutableArray<NSDictionary *> *queue = self.events[socketId];
    if (!queue) {
      queue = [NSMutableArray array];
      self.events[socketId] = queue;
    }
    [queue addObject:event];
  }
}

- (void)cleanupSocketId:(NSString *)socketId {
  @synchronized(self) {
    LynxNativeWebSocketConnection *connection = self.connections[socketId];
    if (connection) {
      [self.taskIds removeObjectForKey:@(connection.task.taskIdentifier)];
    }
    [self.connections removeObjectForKey:socketId];
  }
}

- (BOOL)hasTerminalEvent:(NSArray<NSDictionary *> *)drained {
  for (NSDictionary *event in drained) {
    NSString *type = event[@"type"];
    if ([type isEqualToString:@"close"] || [type isEqualToString:@"error"]) {
      return YES;
    }
  }
  return NO;
}

@end
