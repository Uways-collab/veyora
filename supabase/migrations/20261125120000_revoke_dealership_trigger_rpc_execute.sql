-- Trigger-only dealership functions must not be callable through the Supabase RPC API.
-- Their SECURITY DEFINER execution is limited to trigger invocation; table RLS remains
-- responsible for authorising the originating INSERT/UPDATE.
REVOKE ALL ON FUNCTION public.dealer_prevent_test_drive_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dealer_sync_vehicle_status_from_deal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dealer_sync_vehicle_status_from_service() FROM PUBLIC, anon, authenticated;
