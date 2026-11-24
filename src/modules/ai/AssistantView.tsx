import { useState, type FormEvent } from 'react';
import { Bot, Loader2, MessageCircle, Send, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';

type Message = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Summarise my business performance over the last 30 days.',
  'What should I check if some products are running low?',
  'How can I improve my sales operations?',
  'Explain how to use Veyora for my business category.',
];

export function AssistantView() {
  const { activeOrganisation, activeRole, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event?: FormEvent, prompt?: string) => {
    event?.preventDefault();
    const message = (prompt ?? draft).trim();
    if (!message || busy || !activeOrganisation || !user) return;
    const previous = messages.slice(-8);
    const nextMessages: Message[] = [...messages, { role: 'user', content: message }];
    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Connect Veyora to Supabase before using the AI assistant.');
      const { data, error: invokeError } = await supabase.functions.invoke('veyora-ai-assistant', {
        body: {
          organization_id: activeOrganisation.id,
          message,
          history: previous,
        },
      });
      if (invokeError) throw invokeError;
      if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error(data?.error ?? 'Veyora AI did not return an answer. Please try again.');
      }
      setMessages((current) => [...current, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veyora AI is temporarily unavailable.');
      setMessages(nextMessages);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
            <Sparkles className="h-4 w-4" /> Veyora intelligence
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">AI Business Assistant</h1>
          <p className="mt-1 text-sm text-slate-600">Ask questions about your operations and get practical guidance based on available workspace summaries.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{activeOrganisation?.name ?? 'Workspace'}</span>
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="capitalize">{activeRole ?? 'member'}</span>
        </div>
      </header>

      <section className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#10223c] text-white"><Bot className="h-5 w-5" /></span>
          <div>
            <div className="text-sm font-semibold text-slate-900">Veyora AI</div>
            <div className="text-[11px] text-slate-500">Workspace-scoped · Read-only guidance</div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready when configured</span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl py-8 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><MessageCircle className="h-6 w-6" /></span>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">What would you like help with?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Veyora AI can explain workflows and summarise limited operational metrics. It cannot create or edit business records.</p>
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" disabled={busy} onClick={() => void send(undefined, suggestion)} className="rounded-xl border border-slate-200 bg-white p-3 text-left text-xs leading-5 text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-50">{suggestion}</button>
                ))}
              </div>
            </div>
          ) : messages.map((message, index) => (
            <div key={index} className={'flex gap-3 ' + (message.role === 'user' ? 'justify-end' : 'justify-start')}>
              {message.role === 'assistant' && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#10223c] text-white"><Bot className="h-4 w-4" /></span>}
              <div className={'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ' + (message.role === 'user' ? 'bg-blue-700 text-white' : 'border border-slate-200 bg-slate-50 text-slate-800')}>
                {message.content}
              </div>
              {message.role === 'user' && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700"><UserRound className="h-4 w-4" /></span>}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Veyora AI is reviewing the available workspace summary…</div>}
          {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{error}</div>}
        </div>

        <form onSubmit={(event) => void send(event)} className="border-t border-slate-200 bg-white p-3 sm:p-4">
          <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/10">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} maxLength={2000} placeholder="Ask Veyora about your business…" className="max-h-32 min-h-12 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400" />
            <button type="submit" disabled={busy || !draft.trim()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" /><span className="hidden sm:inline">Send</span></button>
          </div>
          <p className="mt-2 px-1 text-[10px] leading-4 text-slate-400">AI responses can be inaccurate. Verify figures in the relevant Veyora module before making business decisions. Do not send passwords or payment credentials.</p>
        </form>
      </section>
    </div>
  );
}
