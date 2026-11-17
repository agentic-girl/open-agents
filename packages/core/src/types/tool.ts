import { z } from 'zod';

export interface ToolContext {
  sessionId: string;
  toolName: string;
}

export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (args: z.infer<TSchema>, context: ToolContext) => Promise<TResult>;
}

export type AnyToolDefinition = ToolDefinition<any, any>;
