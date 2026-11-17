export type InterruptType = 'tool_approval' | 'user_input';
export type InterruptStatus = 'pending' | 'approved' | 'rejected';

export interface Interrupt {
  id: string;
  sessionId: string;
  type: InterruptType;
  status: InterruptStatus;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  reason: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface ApprovalDecision {
  interruptId: string;
  approved: boolean;
  modifiedArgs?: Record<string, unknown>;
  feedback?: string;
}
