import {
  ConfigBase,
  extendConfigSchema,
  InitConfigBase,
} from '@huolala-tech/page-spy-base/dist/config';

/** Lynx 侧目前复用 PageSpy 基础配置，预留扩展 schema 入口。 */
const schema: any = extendConfigSchema((z) => {
  return z.object({});
});

export type InitConfig = InitConfigBase;

/** PageSpy ReactLynx 配置对象，封装基础配置校验和平台扩展位。 */
export class Config extends ConfigBase<InitConfig> {
  protected schema = schema;

  /** 平台专属配置扩展位，保持和基础 SDK 的配置结构一致。 */
  platform = {};
}
