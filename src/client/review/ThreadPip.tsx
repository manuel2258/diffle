import { Check, MessageSquare, MessagesSquare } from 'lucide-react';
import { useStore } from '@/client/store.js';
import type { CommentThread } from '@/shared/protocol.js';

/**
 * The hidden threads of one line: an annotation of no height, so they take no row, with markers
 * hung above it onto the right end of the line. Threads put away while open and resolved ones get
 * a marker each, since they mean different things; pressing one shows its cards again.
 */
export function ThreadPip({ threads }: { threads: CommentThread[] }) {
  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  return (
    <div className="relative h-0">
      <div className="absolute right-2 bottom-0.5 flex gap-1">
        {open.length > 0 && <Marker threads={open} resolved={false} />}
        {resolved.length > 0 && <Marker threads={resolved} resolved />}
      </div>
    </div>
  );
}

function Marker({ threads, resolved }: { threads: CommentThread[]; resolved: boolean }) {
  const setThreadHidden = useStore((s) => s.setThreadHidden);
  const messages = threads.reduce((n, t) => n + t.messages.length, 0);
  const what =
    threads.length === 1
      ? `the ${resolved ? 'resolved ' : ''}thread (${messages} message${messages === 1 ? '' : 's'}${resolved ? '' : ', H'})`
      : `${threads.length} ${resolved ? 'resolved ' : ''}threads (${messages} messages)`;
  const Icon = resolved ? Check : threads.length === 1 ? MessageSquare : MessagesSquare;
  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center gap-0.75 rounded-full border bg-card px-1.5 font-sans text-[0.6875rem] leading-4 hover:bg-hover ${resolved ? 'border-border text-muted' : 'border-accent text-accent'}`}
      title={`Show ${what}`}
      aria-label={`Show ${what}`}
      onClick={() => void Promise.all(threads.map((t) => setThreadHidden(t, false)))}
    >
      <Icon size="0.6875rem" />
      {messages}
    </button>
  );
}
