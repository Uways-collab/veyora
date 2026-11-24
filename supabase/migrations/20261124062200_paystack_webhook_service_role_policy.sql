create policy "Service role manages Paystack webhook events"
  on public.paystack_webhook_events
  for all to service_role
  using (true)
  with check (true);
