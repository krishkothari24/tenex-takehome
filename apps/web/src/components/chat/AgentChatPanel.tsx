import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { AgentChatStatus, ChatTurn } from '../../hooks/useAgentChatStream';

const EXAMPLE_QUERIES = [
  "What's my most urgent unread thing today?",
  'Find emails from Sarah about the contract',
  'Summarize what happened this week',
];

/**
 * The chat panel (docs/AGENTIC_CHAT.md §8) — a message list + input, rendering `status` events as
 * a visible inline tool-activity indicator (never a bare spinner) and `draft` turns as a distinct,
 * clearly-labeled card, never a plain chat bubble, so it reads unambiguously as "not sent." All
 * text here — model output and email-derived content alike — is plain JSX interpolation, never
 * `dangerouslySetInnerHTML`; this is the one place raw LLM output and email snippets both reach
 * the DOM through a single component.
 */
export function AgentChatPanel({
  transcript,
  status,
  statusText,
  errorMessage,
  onSend,
}: {
  transcript: ChatTurn[];
  status: AgentChatStatus;
  statusText: string | null;
  errorMessage: string | null;
  onSend: (message: string) => void;
}) {
  const [input, setInput] = useState('');
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const isRunning = status === 'running';
  const reduceMotion = useReducedMotion();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' });
  }, [transcript, statusText, reduceMotion]);

  async function handleCopy(turnId: string, draftText: string) {
    await navigator.clipboard.writeText(draftText);
    setCopiedTurnId(turnId);
    setTimeout(() => setCopiedTurnId((prev) => (prev === turnId ? null : prev)), 2000);
  }

  function submit() {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    onSend(trimmed);
    setInput('');
  }

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col rounded-lg border border-slate-800 bg-slate-900">
      <div aria-live="polite" role="log" className="flex-1 space-y-3 overflow-y-auto p-6">
        {transcript.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Ask about your already-classified inbox — search, summarize, or draft a reply. Nothing is ever sent;
              drafts are yours to copy and send yourself.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {transcript.map((turn) => (
          <ChatTurnBubble
            key={turn.id}
            turn={turn}
            reduceMotion={reduceMotion === true}
            copied={copiedTurnId === turn.id}
            onCopy={() => turn.kind === 'draft' && void handleCopy(turn.id, turn.draftText)}
          />
        ))}

        {isRunning && statusText && (
          <motion.p
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm text-slate-400"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" aria-hidden="true" />
            {statusText}
          </motion.p>
        )}

        {status === 'error' && errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}

        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-800 p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about your inbox…"
            rows={1}
            maxLength={4000}
            disabled={isRunning}
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={isRunning || input.trim().length === 0}
            className="shrink-0 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          >
            {isRunning ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatTurnBubble({
  turn,
  reduceMotion,
  copied,
  onCopy,
}: {
  turn: ChatTurn;
  reduceMotion: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const motionProps = {
    initial: reduceMotion ? false : ({ opacity: 0, y: 4 } as const),
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduceMotion ? 0 : 0.2 },
  };

  if (turn.kind === 'user') {
    return (
      <motion.div {...motionProps} className="ml-auto max-w-[80%] rounded-lg bg-indigo-500/90 px-4 py-2 text-sm text-white">
        {turn.text}
      </motion.div>
    );
  }

  if (turn.kind === 'draft') {
    return (
      <motion.div
        {...motionProps}
        className="max-w-[80%] rounded-md border border-indigo-500/40 bg-slate-950/60 p-3"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">Draft reply — not sent</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-100">{turn.draftText}</p>
        <button
          onClick={onCopy}
          className="mt-1.5 rounded px-1.5 py-0.5 text-xs font-medium text-indigo-300 hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          {copied ? 'Copied!' : 'Copy draft'}
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div {...motionProps} className="max-w-[80%] rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-100">
      <p className="whitespace-pre-wrap">{turn.text}</p>
      {turn.hitIterationCap && (
        <p className="mt-1 text-xs text-amber-400">Stopped early — hit this turn&rsquo;s step limit.</p>
      )}
    </motion.div>
  );
}
