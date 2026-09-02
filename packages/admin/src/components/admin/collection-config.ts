import type { CollectionConfig, ResolvedConfig } from '@plinto/core';

export type CollectionConfigErrorCode =
  | 'not-configured'
  | 'body-in-puck'
  | 'body-wrong-type'
  | 'richtext-not-body'
  | 'select-missing-options'
  | 'title-missing';

export class CollectionConfigError extends Error {
  constructor(public code: CollectionConfigErrorCode, message: string) {
    super(message);
    this.name = 'CollectionConfigError';
  }
}

export function listCollections(config: ResolvedConfig): Array<{ name: string; label: string }> {
  const map = config.content.collections ?? {};
  return Object.entries(map).map(([name, cfg]) => ({ name, label: (cfg as unknown as CollectionConfig).label }));
}

export function getCollectionConfig(config: ResolvedConfig, name: string): CollectionConfig {
  const map = config.content.collections ?? {};
  const cfg = map[name];
  if (!cfg) {
    throw new CollectionConfigError(
      'not-configured',
      `Collection "${name}" has no editor config. Add it to your plinto() config under content.collections.`,
    );
  }
  const typedCfg = cfg as unknown as CollectionConfig;
  validate(name, typedCfg);
  return typedCfg;
}

function validate(name: string, cfg: CollectionConfig): void {
  const keys = cfg.fields.map(f => f.key);

  if (!keys.includes(cfg.titleField)) {
    throw new CollectionConfigError(
      'title-missing',
      `Collection "${name}": titleField "${cfg.titleField}" is not a declared field.`,
    );
  }

  for (const field of cfg.fields) {
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      throw new CollectionConfigError(
        'select-missing-options',
        `Collection "${name}", field "${field.key}": select type requires non-empty options.`,
      );
    }
    // The declared contract (see CollectionFieldConfig): richtext is only
    // valid for the body. Catch it here rather than crashing FieldInput.
    if (field.type === 'richtext' && field.key !== 'body') {
      throw new CollectionConfigError(
        'richtext-not-body',
        `Collection "${name}", field "${field.key}": type 'richtext' is only valid for the 'body' field.`,
      );
    }
    if (field.key === 'body') {
      if (cfg.editor === 'puck') {
        throw new CollectionConfigError(
          'body-in-puck',
          `Collection "${name}": body field is not allowed in editor:'puck' (Puck owns the body).`,
        );
      }
      if (field.type !== 'richtext') {
        throw new CollectionConfigError(
          'body-wrong-type',
          `Collection "${name}": body field must be type:'richtext', got "${field.type}".`,
        );
      }
    }
  }
}
