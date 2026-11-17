import { AnyToolDefinition } from './tool.js';

export interface HarnessLimits {
  maxSteps: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface HarnessUsage {
  stepsTaken: number;
  tokensUsed: number;
  elapsedMs: number;
}

export interface ApprovalRule {
  toolName: string;
  condition?: (args: Record<string, unknown>) => boolean;
  message?: string;
}

export interface HarnessConfig {
  agentId: string;
  instructions: string;
  model?: string;
  tools?: AnyToolDefinition[];
  limits?: Partial<HarnessLimits>;
  approvalRules?: ApprovalRule[];
}

export interface HarnessRunOptions {
  sessionId: string;
  prompt: string;
  resumeInterruptId?: string;
}

export interface HarnessRunResult {
  sessionId: string;
  status: 'completed' | 'suspended' | 'failed';
  output?: string;
  error?: string;
  usage: HarnessUsage;
}
