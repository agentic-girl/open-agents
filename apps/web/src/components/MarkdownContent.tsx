import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';

interface MarkdownContentProps {
  content: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  return (
    <div className="space-y-3 text-[15px] leading-7 text-zinc-100 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-7">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-6 space-y-1.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 space-y-1.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-7">{children}</li>,
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold text-white pt-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-white pt-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-white pt-1">{children}</h3>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-600 pl-4 italic text-zinc-300">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-zinc-700/80">
              <table className="w-full text-left text-sm border-collapse">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="bg-zinc-800/80 px-3 py-2 font-medium text-zinc-200 border-b border-zinc-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b border-zinc-800 text-zinc-300">
              {children}
            </td>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const rawText = String(children).replace(/\n$/, '');
            const match = /language-([\w-]+)/.exec(className ?? '');
            const isMultiline = Boolean(match) || rawText.includes('\n');

            if (!isMultiline) {
              return (
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[13px] text-zinc-200">
                  {children}
                </code>
              );
            }

            return <CodeBlock language={match?.[1] ?? 'text'} code={rawText} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

const CodeBlock: React.FC<{ language: string; code: string }> = ({
  language,
  code,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden bg-[#141414] border border-zinc-800">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1b1b1b] border-b border-zinc-800/80 text-xs text-zinc-400">
        <span className="font-mono">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[13px] leading-6 font-mono text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
};
