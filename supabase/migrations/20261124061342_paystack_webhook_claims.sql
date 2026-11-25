alter table public.paystack_webhook_events
  add column if not exists processing_started_at timestamptz;

create index if not exists paystack_webhook_events_unprocessed_idx
  on public.paystack_webhook_events(received_at)
  where processed_at is null;
