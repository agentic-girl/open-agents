import React, { useState } from 'react';
import { CheckCircle2, KeyRound, X } from 'lucide-react';
import type { CredentialStatus } from '../types';

interface CredentialsModalProps {
  open: boolean;
  onClose: () => void;
  status: CredentialStatus | null;
  onSaveKey: (apiKey: string | null) => Promise<void>;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({
  open,
  onClose,
  status,
  onSaveKey,
}) => {
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || saving) return;
    setSaving(true);
    try {
      await onSaveKey(keyInput.trim());
      setKeyInput('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClearOverride = async () => {
    setSaving(true);
    try {
      await onSaveKey(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#1b1b1b] p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <KeyRound className="w-4 h-4 text-zinc-300" />
            <span>Harness Credentials</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {status?.configured ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Active via{' '}
                <strong className="font-mono">{status.source}</strong>
                {status.maskedKey ? ` (${status.maskedKey})` : ''}
              </span>
            </div>
            {status.source === 'store' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleClearOverride()}
                className="text-zinc-300 hover:text-white underline"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-400 leading-relaxed">
            Paste an <code className="text-zinc-200">ANTHROPIC_API_KEY</code> to
            enable the Claude Agent SDK immediately without restarting the
            server, or rely on an active local{' '}
            <code className="text-zinc-200">claude auth login</code> session.
          </p>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">
              {status?.configured ? 'Override Anthropic API Key' : 'Anthropic API Key'}
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-api03-..."
              autoFocus
              className="w-full rounded-xl border border-zinc-700 bg-[#141414] px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-400 focus:outline-none font-mono"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!keyInput.trim() || saving}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-white disabled:bg-zinc-700 text-zinc-900 disabled:text-zinc-500 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
