'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Bot, Sparkles, X } from 'lucide-react';

const Drawer = dynamic(
  () => import('./agent-chat-drawer').then((module) => module.AgentChatDrawer),
  {
    ssr: false,
    loading: () => (
      <button className="agent-fab" type="button" disabled>
        جارٍ تحميل المساعد…
      </button>
    ),
  },
);

/** Keep the floating entry point small; load chat/booking only when requested. */
export function AgentChatLauncher() {
  const [loaded, setLoaded] = useState(false);
  const [tooltip, setTooltip] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTooltip(false), 9000);
    return () => clearTimeout(timer);
  }, []);
  if (loaded) return <Drawer initialOpen />;
  return (
    <>
      {tooltip && (
        <div role="status" className="agent-tooltip-bubble">
          <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
          <button
            type="button"
            onClick={() => setLoaded(true)}
            className="border-0 bg-transparent p-0 text-inherit"
          >
            هل تحتاج مساعدة في اختيار طبيبك؟
          </button>
          <button
            type="button"
            onClick={() => setTooltip(false)}
            aria-label="إغلاق التلميح"
            className="rounded p-0.5 text-slate-600 hover:text-slate-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setLoaded(true)}
        aria-label="افتح المساعد الطبي الذكي"
        aria-expanded="false"
        className="agent-fab"
      >
        <span className="agent-fab-badge">
          <span className="agent-fab-badge-ping" />
          <span className="agent-fab-badge-dot" />
        </span>
        <Bot className="h-4 w-4 shrink-0 text-white" />
        <span className="font-semibold tracking-wide text-white">المساعد الطبي</span>
      </button>
    </>
  );
}
