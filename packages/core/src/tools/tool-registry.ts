import { z } from 'zod';
import { AnyToolDefinition, ToolContext, ToolDefinition } from '../types/tool.js';

export function defineTool<TSchema extends z.ZodTypeAny, TResult>(
  definition: ToolDefinition<TSchema, TResult>,
): ToolDefinition<TSchema, TResult> {
  return definition;
}

export class ToolRegistry {
  private tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): AnyToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, rawArgs: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found in registry.`);
    }

    // Validate parameters against Zod schema
    const parsedArgs = tool.parameters.parse(rawArgs);
    return tool.execute(parsedArgs, context);
  }

  /**
   * Converts Zod-based tools into Anthropic Claude tool schemas
   */
  toAnthropicTools(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return this.list().map((tool) => {
      // Basic JSON schema generation for Zod objects
      const inputSchema = zodToJsonSchema(tool.parameters);
      return {
        name: tool.name,
        description: tool.description,
        input_schema: inputSchema,
      };
    });
  }
}

/**
 * Lightweight Zod to JSON Schema converter for Anthropic tool calling
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodTypeAny;
      if (!field.isOptional()) {
        required.push(key);
      }
      properties[key] = zodFieldToJsonSchema(field);
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: 'object' };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  let current = field;
  let isOptional = false;

  if (current instanceof z.ZodOptional) {
    isOptional = true;
    current = current.unwrap();
  }

  let description: string | undefined = current.description;

  if (current instanceof z.ZodString) {
    return { type: 'string', ...(description ? { description } : {}) };
  }
  if (current instanceof z.ZodNumber) {
    return { type: 'number', ...(description ? { description } : {}) };
  }
  if (current instanceof z.ZodBoolean) {
    return { type: 'boolean', ...(description ? { description } : {}) };
  }
  if (current instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodFieldToJsonSchema(current.element),
      ...(description ? { description } : {}),
    };
  }
  if (current instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: current._def.values,
      ...(description ? { description } : {}),
    };
  }

  return { type: 'string', ...(description ? { description } : {}) };
}
