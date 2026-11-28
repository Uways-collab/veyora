create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, user_id)
);

create table if not exists public.ai_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  created_at timestamptz not null default now(),
  constraint ai_conversation_messages_conversation_fk
    foreign key (conversation_id, organization_id, user_id)
    references public.ai_conversations(id, organization_id, user_id)
    on delete cascade
);

create index if not exists ai_conversations_owner_recent_idx
  on public.ai_conversations(organization_id, user_id, updated_at desc);
create index if not exists ai_conversation_messages_order_idx
  on public.ai_conversation_messages(conversation_id, created_at, id);

alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_messages enable row level security;

grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert, delete on public.ai_conversation_messages to authenticated;

drop policy if exists "Users manage their own AI conversations" on public.ai_conversations;
create policy "Users manage their own AI conversations"
on public.ai_conversations
for all
to authenticated
using (
  user_id = (select auth.uid())
  and private.organization_has_access(organization_id, 'ai_assistant')
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = ai_conversations.organization_id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  )
  and private.organization_has_access(organization_id, 'ai_assistant')
);

drop policy if exists "Users manage messages in their own AI conversations" on public.ai_conversation_messages;
create policy "Users manage messages in their own AI conversations"
on public.ai_conversation_messages
for all
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_conversation_messages.conversation_id
      and c.organization_id = ai_conversation_messages.organization_id
      and c.user_id = (select auth.uid())
  )
  and private.organization_has_access(organization_id, 'ai_assistant')
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_conversation_messages.conversation_id
      and c.organization_id = ai_conversation_messages.organization_id
      and c.user_id = (select auth.uid())
  )
  and private.organization_has_access(organization_id, 'ai_assistant')
);

create or replace function public.touch_ai_conversation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  update public.ai_conversations
  set updated_at = pg_catalog.now()
  where id = new.conversation_id;
  return new;
end;
$function$;

revoke all on function public.touch_ai_conversation_updated_at() from public, anon, authenticated;

drop trigger if exists touch_ai_conversation_on_message on public.ai_conversation_messages;
create trigger touch_ai_conversation_on_message
after insert on public.ai_conversation_messages
for each row execute function public.touch_ai_conversation_updated_at();
