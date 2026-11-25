-- The AI assistant is available on all tiers with tier-specific monthly request caps.
update public.subscription_plans
set features=jsonb_set(coalesce(features,'{}'::jsonb),'{ai_assistant}','true'::jsonb,true),
    ai_assistant_requests=case
      when code like 'starter_%' then 10
      when code like 'standard_%' then 100
      else 500
    end,
    updated_at=now()
where code like 'starter_%' or code like 'standard_%' or code like 'premium_%';
