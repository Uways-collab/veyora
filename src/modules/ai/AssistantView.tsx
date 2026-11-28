import { useEffect, useState, type FormEvent } from 'react';
import { Bot, History, Loader2, MessageCircle, Plus, Send, Sparkles, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';

type Message = { role: 'user' | 'assistant'; content: string };
type Conversation = { id: string; title: string; updated_at: string };

const SUGGESTIONS = [
  'Summarise my business performance over the last 30 days.',
  'Compare my sales this month with the previous 30 days.',
  'Which products have gained demand in the last 30 days?',
  'What products should I prioritise for replenishment using sales and low-stock data?',
  'Recommend replenishment for my low-stock items.',
  'What should I check if some products are running low?',
  'How can I improve my sales operations?',
  'Explain how to use Veyora for my business category.',
  'Which hotel check-ins are coming up in the next 30 days?',
  'Which vehicles are still available in dealership stock?',
  'Which active leases are ending soon?',
  'What is the current restaurant kitchen order backlog?',
  'Which delivery jobs are overdue?',
  'How is production progressing against planned quantities?',
];

function conversationTitle(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > 64 ? clean.slice(0, 61) + '…' : clean || 'New conversation';
}

export function AssistantView() {
  const { activeOrganisation, activeRole, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadConversations = async () => {
      const supabase = getSupabaseClient();
      if (!supabase || !activeOrganisation || !user) {
        setConversations([]);
        setMessages([]);
        setActiveConversationId(null);
        return;
      }
      setLoadingHistory(true);
      setHistoryError(null);
      setMessages([]);
      setActiveConversationId(null);
      const { data, error: loadError } = await (supabase as any)
        .from('ai_conversations')
        .select('id,title,updated_at')
        .eq('organization_id', activeOrganisation.id)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (loadError) setHistoryError('Could not load AI history. Please refresh and try again.');
      else setConversations((data ?? []) as Conversation[]);
      setLoadingHistory(false);
    };
    void loadConversations();
    return () => { cancelled = true; };
  }, [activeOrganisation?.id, user?.id]);

  const startNewConversation = () => {
    if (busy) return;
    setActiveConversationId(null);
    setMessages([]);
    setDraft('');
    setError(null);
  };

  const openConversation = async (conversationId: string) => {
    if (busy || !activeOrganisation || !user) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoadingHistory(true);
    setError(null);
    const { data, error: loadError } = await (supabase as any)
      .from('ai_conversation_messages')
      .select('role,content')
      .eq('conversation_id', conversationId)
      .eq('organization_id', activeOrganisation.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (loadError) {
      setError('Could not open this conversation. Please try again.');
    } else {
      setActiveConversationId(conversationId);
      setMessages((data ?? []) as Message[]);
    }
    setLoadingHistory(false);
  };

  const deleteConversation = async (conversationId: string) => {
    if (busy || !user) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error: deleteError } = await (supabase as any)
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', user.id);
    if (deleteError) {
      setHistoryError('Could not delete this conversation. Please try again.');
      return;
    }
    setConversations((current) => current.filter((item) => item.id !== conversationId));
    if (activeConversationId === conversationId) startNewConversation();
  };

  const send = async (event?: FormEvent, prompt?: string) => {
    event?.preventDefault();
    const message = (prompt ?? draft).trim();
    if (!message || busy || !activeOrganisation || !user) return;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('Connect Veyora to Supabase before using the AI assistant.');
      return;
    }
    const previous = messages.slice(-8);
    const nextMessages: Message[] = [...messages, { role: 'user', content: message }];
    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const { data: created, error: createError } = await supabase
          .from('ai_conversations')
          .insert({
            organization_id: activeOrganisation.id,
            user_id: user.id,
            title: conversationTitle(message),
          })
          .select('id,title,updated_at')
          .single();
        if (createError || !created) throw createError ?? new Error('Could not start an AI conversation.');
        conversationId = created.id;
        setActiveConversationId(conversationId);
        setConversations((current) => [created as Conversation, ...current]);
      }

      const { error: userSaveError } = await (supabase as any)
        .from('ai_conversation_messages')
        .insert({
          conversation_id: conversationId,
          organization_id: activeOrganisation.id,
          user_id: user.id,
          role: 'user',
          content: message,
        });
      if (userSaveError) throw userSaveError;

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
      const { error: assistantSaveError } = await (supabase as any)
        .from('ai_conversation_messages')
        .insert({
          conversation_id: conversationId,
          organization_id: activeOrganisation.id,
          user_id: user.id,
          role: 'assistant',
          content: data.answer,
        });
      if (assistantSaveError) setError('Your answer is ready, but could not be saved to AI history. Please try again later.');
      setConversations((current) => current
        .map((item) => item.id === conversationId ? { ...item, updated_at: new Date().toISOString() } : item)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veyora AI is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-6xl flex-col gap-6">
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

      <div className="grid min-h-[560px] flex-1 gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3">
          <button type="button" onClick={startNewConversation} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
            <Plus className="h-4 w-4" /> New conversation
          </button>
          <div className="mb-2 mt-4 flex items-center gap-2 px-1 text-xs font-semibold text-slate-700">
            <History className="h-3.5 w-3.5" /> Recent history
          </div>
          {historyError && <p role="alert" className="px-1 py-2 text-[11px] text-rose-700">{historyError}</p>}
          {loadingHistory && <div className="flex items-center gap-2 px-1 py-3 text-[11px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…</div>}
          {!loadingHistory && conversations.length === 0 && <p className="px-1 py-3 text-[11px] leading-5 text-slate-500">Your saved conversations will appear here.</p>}
          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {conversations.map((conversation) => (
              <div key={conversation.id} className={'group flex items-start gap-1 rounded-lg ' + (activeConversationId === conversation.id ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                <button type="button" onClick={() => void openConversation(conversation.id)} disabled={busy} className="min-w-0 flex-1 px-2 py-2 text-left disabled:opacity-50">
                  <span className="block truncate text-xs font-medium text-slate-800">{conversation.title}</span>
                  <span className="mt-1 block text-[10px] text-slate-400">{new Date(conversation.updated_at).toLocaleDateString()}</span>
                </button>
                <button type="button" onClick={() => void deleteConversation(conversation.id)} disabled={busy} aria-label={'Delete conversation: ' + conversation.title} title="Delete conversation" className="mr-1 mt-2 rounded p-1 text-slate-400 opacity-100 hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#10223c] text-white"><Bot className="h-5 w-5" /></span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Veyora AI</div>
              <div className="text-[11px] text-slate-500">Workspace-scoped · Read-only guidance · Saved privately to your account</div>
            </div>
            <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Read-only assistant</span>
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
    </div>
  );
}
