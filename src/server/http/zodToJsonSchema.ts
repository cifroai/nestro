import { type z, ZodFirstPartyTypeKind, type ZodTypeAny } from 'zod';

/**
 * Преобразование Zod-схемы в JSON Schema для OpenAPI.
 * Реализовано локально, чтобы контракт API строился из тех же схем, которыми
 * выполняется валидация, без дополнительной зависимости.
 */

interface JsonSchemaNode {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  nullable?: boolean;
  oneOf?: JsonSchemaNode[];
  description?: string;
  default?: unknown;
}

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; nullable: boolean; def?: unknown } {
  let current = schema;
  let optional = false;
  let nullable = false;
  let defaultValue: unknown;

  for (;;) {
    const typeName = (current._def as { typeName?: ZodFirstPartyTypeKind }).typeName;
    if (typeName === ZodFirstPartyTypeKind.ZodOptional) {
      optional = true;
      current = (current as z.ZodOptional<ZodTypeAny>).unwrap();
      continue;
    }
    if (typeName === ZodFirstPartyTypeKind.ZodNullable) {
      nullable = true;
      current = (current as z.ZodNullable<ZodTypeAny>).unwrap();
      continue;
    }
    if (typeName === ZodFirstPartyTypeKind.ZodDefault) {
      const def = current._def as { defaultValue: () => unknown; innerType: ZodTypeAny };
      defaultValue = def.defaultValue();
      optional = true;
      current = def.innerType;
      continue;
    }
    if (typeName === ZodFirstPartyTypeKind.ZodEffects) {
      current = (current._def as { schema: ZodTypeAny }).schema;
      continue;
    }
    break;
  }

  return { inner: current, optional, nullable, def: defaultValue };
}

function stringChecks(schema: z.ZodString): JsonSchemaNode {
  const node: JsonSchemaNode = { type: 'string' };
  for (const check of schema._def.checks) {
    if (check.kind === 'min') node.minLength = check.value;
    if (check.kind === 'max') node.maxLength = check.value;
    if (check.kind === 'email') node.format = 'email';
    if (check.kind === 'url') node.format = 'uri';
    if (check.kind === 'datetime') node.format = 'date-time';
  }
  return node;
}

function numberChecks(schema: z.ZodNumber): JsonSchemaNode {
  const node: JsonSchemaNode = { type: schema.isInt ? 'integer' : 'number' };
  for (const check of schema._def.checks) {
    if (check.kind === 'min') node.minimum = check.value;
    if (check.kind === 'max') node.maximum = check.value;
    if (check.kind === 'int') node.type = 'integer';
  }
  return node;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchemaNode {
  const { inner, nullable, def } = unwrap(schema);
  const typeName = (inner._def as { typeName?: ZodFirstPartyTypeKind }).typeName;
  let node: JsonSchemaNode;

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      node = stringChecks(inner as z.ZodString);
      break;
    case ZodFirstPartyTypeKind.ZodNumber:
      node = numberChecks(inner as z.ZodNumber);
      break;
    case ZodFirstPartyTypeKind.ZodBoolean:
      node = { type: 'boolean' };
      break;
    case ZodFirstPartyTypeKind.ZodDate:
      node = { type: 'string', format: 'date-time' };
      break;
    case ZodFirstPartyTypeKind.ZodLiteral:
      node = { const: (inner._def as { value: unknown }).value };
      break;
    case ZodFirstPartyTypeKind.ZodEnum:
      node = { type: 'string', enum: [...(inner as z.ZodEnum<[string, ...string[]]>).options] };
      break;
    case ZodFirstPartyTypeKind.ZodNativeEnum:
      node = { enum: Object.values((inner._def as { values: object }).values) };
      break;
    case ZodFirstPartyTypeKind.ZodArray: {
      const arrayDef = inner._def as { type: ZodTypeAny; minLength?: { value: number }; maxLength?: { value: number } };
      node = { type: 'array', items: zodToJsonSchema(arrayDef.type) };
      if (arrayDef.minLength) node.minItems = arrayDef.minLength.value;
      if (arrayDef.maxLength) node.maxItems = arrayDef.maxLength.value;
      break;
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchemaNode> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const child = value as ZodTypeAny;
        properties[key] = zodToJsonSchema(child);
        const info = unwrap(child);
        if (!info.optional) required.push(key);
      }
      node = { type: 'object', properties, additionalProperties: false };
      if (required.length > 0) node.required = required;
      break;
    }
    case ZodFirstPartyTypeKind.ZodRecord:
      node = { type: 'object', additionalProperties: zodToJsonSchema((inner._def as { valueType: ZodTypeAny }).valueType) };
      break;
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const options = [...(inner._def as { options: ZodTypeAny[] }).options];
      node = { oneOf: options.map((option) => zodToJsonSchema(option)) };
      break;
    }
    case ZodFirstPartyTypeKind.ZodUnion: {
      const options = (inner._def as { options: ZodTypeAny[] }).options;
      node = { oneOf: options.map((option) => zodToJsonSchema(option)) };
      break;
    }
    default:
      node = {};
  }

  if (nullable) node.nullable = true;
  if (def !== undefined) node.default = def;
  return node;
}
