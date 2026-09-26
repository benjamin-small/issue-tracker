import {
  type KyselyPlugin,
  OperationNodeTransformer,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type PrimitiveValueListNode,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
  type ValueNode,
} from 'kysely';

class BooleanToIntegerTransformer extends OperationNodeTransformer {
  protected override transformValue(node: ValueNode): ValueNode {
    const transformed = super.transformValue(node);
    return typeof transformed.value === 'boolean'
      ? { ...transformed, value: transformed.value ? 1 : 0 }
      : transformed;
  }

  protected override transformPrimitiveValueList(
    node: PrimitiveValueListNode,
  ): PrimitiveValueListNode {
    const transformed = super.transformPrimitiveValueList(node);
    return {
      ...transformed,
      values: transformed.values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)),
    };
  }
}

/**
 * better-sqlite3 refuses to bind JavaScript booleans. This plugin rewrites boolean parameters to 1/0
 * so portable code can always write `true`/`false`. Reads still return 0/1 — normalize with `toBool()`.
 */
export class SqliteBooleanPlugin implements KyselyPlugin {
  readonly #transformer = new BooleanToIntegerTransformer();

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.#transformer.transformNode(args.node);
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}
