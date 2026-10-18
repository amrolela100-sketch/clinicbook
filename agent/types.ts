import { z } from 'zod';

export interface ToolDefinition<TInput extends z.ZodTypeAny, TOutput = unknown> {
  name?: string;
  description: string;
  inputSchema: TInput;
  execute: (input: z.infer<TInput>, context?: Record<string, unknown>) => Promise<TOutput> | TOutput;
}

export function defineTool<TInput extends z.ZodTypeAny, TOutput = unknown>(
  config: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return config;
}

export interface AgentConfig {
  model: string;
  reasoning?: 'low' | 'medium' | 'high';
  temperature?: number;
  maxTokens?: number;
}

export function defineAgent(config: AgentConfig): AgentConfig {
  return config;
}
