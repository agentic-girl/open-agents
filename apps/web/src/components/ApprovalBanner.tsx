import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Code } from 'lucide-react';
import { PendingInterrupt } from '../types';

interface ApprovalBannerProps {
  interrupt: PendingInterrupt;
  onApprove: (approved: boolean, feedback?: string) => void;
}

export const ApprovalBanner: React.FC<ApprovalBannerProps> = ({ interrupt, onApprove }) => {
  const [feedback, setFeedback] = useState('');
  const [showArgs, setShowArgs] = useState(true);

  return (
    <div className="my-4 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 shadow-lg shadow-amber-950/20">
      <div className="flex items-start space-x-3">
        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 mt-0.5 border border-amber-500/20">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-300">
              Human-In-The-Loop Approval Required
            </h3>
            <span className="text-[10px] font-mono uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
              Suspended
            </span>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">{interrupt.reason}</p>

          {interrupt.toolName && (
            <div className="rounded-lg bg-black/40 border border-zinc-800 p-2.5 space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                <span className="flex items-center space-x-1">
                  <Code className="w-3.5 h-3.5 text-amber-400" />
                  <span>Target Tool:</span>
                  <span className="text-emerald-400 font-semibold">{interrupt.toolName}</span>
                </span>
                <button
                  onClick={() => setShowArgs(!showArgs)}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                >
                  {showArgs ? 'Hide Payload' : 'View Payload'}
                </button>
              </div>

              {showArgs && interrupt.toolArgs && (
                <pre className="text-[11px] text-zinc-300 bg-zinc-950/70 p-2 rounded border border-zinc-800/80 overflow-x-auto">
                  {JSON.stringify(interrupt.toolArgs, null, 2)}
                </pre>
              )}
            </div>
          )}

          <div className="pt-1">
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Optional operator notes or reason..."
              className="w-full bg-black/40 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="pt-2 flex items-center space-x-3">
            <button
              onClick={() => onApprove(true, feedback || undefined)}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Approve & Execute</span>
            </button>
            <button
              onClick={() => onApprove(false, feedback || 'Operation rejected by human operator')}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white font-medium text-xs transition-colors"
            >
              <XCircle className="w-4 h-4" />
              <span>Reject</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
