#import <Foundation/Foundation.h>
#import <Lynx/LynxBaseInspectorOwner.h>
#import <Lynx/LynxInspectorConsoleDelegate.h>
#import <Lynx/LynxModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface PageSpyConsoleModule : NSObject <LynxModule>

+ (void)enqueueConsoleMessage:(NSString *)message;

@end

@interface PageSpyConsoleDelegate : NSObject <LynxInspectorConsoleDelegate>

- (instancetype)initWithInspectorOwner:(id<LynxBaseInspectorOwner>)owner;

+ (instancetype)installWithInspectorOwner:(id<LynxBaseInspectorOwner>)owner;

@end

NS_ASSUME_NONNULL_END
