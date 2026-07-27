#import "PageSpyConsoleModule.h"
#import <objc/runtime.h>

typedef void (^PageSpyConsoleDrainCallback)(NSArray<NSString *> *messages);

static NSMutableArray<NSString *> *PageSpyConsoleMessages;
static char PageSpyConsoleDelegateKey;

@implementation PageSpyConsoleModule

+ (void)initialize {
  if (self == PageSpyConsoleModule.class) {
    PageSpyConsoleMessages = [NSMutableArray array];
  }
}

+ (NSString *)name {
  return @"PageSpyConsoleModule";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"drainMessages" : NSStringFromSelector(@selector(drainMessages:)),
  };
}

+ (void)enqueueConsoleMessage:(NSString *)message {
  if (!message) {
    return;
  }
  @synchronized(PageSpyConsoleMessages) {
    [PageSpyConsoleMessages addObject:message];
  }
}

- (void)drainMessages:(PageSpyConsoleDrainCallback)callback {
  NSArray<NSString *> *drained = @[];
  @synchronized(PageSpyConsoleMessages) {
    drained = [PageSpyConsoleMessages copy];
    [PageSpyConsoleMessages removeAllObjects];
  }
  callback(drained);
}

@end

@implementation PageSpyConsoleDelegate {
  __weak id<LynxBaseInspectorOwner> _owner;
}

- (instancetype)initWithInspectorOwner:(id<LynxBaseInspectorOwner>)owner {
  self = [super init];
  if (self) {
    _owner = owner;
  }
  return self;
}

+ (instancetype)installWithInspectorOwner:(id<LynxBaseInspectorOwner>)owner {
  if (!owner) {
    return nil;
  }
  PageSpyConsoleDelegate *delegate = [[PageSpyConsoleDelegate alloc] initWithInspectorOwner:owner];
  [owner setLynxInspectorConsoleDelegate:delegate];
  objc_setAssociatedObject(
    owner,
    &PageSpyConsoleDelegateKey,
    delegate,
    OBJC_ASSOCIATION_RETAIN_NONATOMIC
  );
  return delegate;
}

- (void)onConsoleMessage:(NSString *)msg {
  if (!_owner) {
    return;
  }
  [PageSpyConsoleModule enqueueConsoleMessage:msg];
}

@end
