import {
  ConfigBase,
  extendConfigSchema,
  SchemaUnwrap,
} from '@huolala-tech/page-spy-base';

const schema = extendConfigSchema((z) => {
  return z.object({});
});

export type InitConfig = SchemaUnwrap<typeof schema>;

export class Config extends ConfigBase<InitConfig> {
  protected schema = schema;

  platform = {};
}
