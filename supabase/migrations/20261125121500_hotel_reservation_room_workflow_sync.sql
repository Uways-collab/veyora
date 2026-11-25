CREATE OR REPLACE FUNCTION public.hotel_sync_room_and_turnover()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.room_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'checked_in' THEN
    UPDATE public.hotel_rooms
       SET status = 'occupied'
     WHERE id = NEW.room_id
       AND organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The reservation room could not be updated for this organisation';
    END IF;
  ELSIF NEW.status = 'checked_out' THEN
    UPDATE public.hotel_rooms
       SET status = 'dirty'
     WHERE id = NEW.room_id
       AND organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The reservation room could not be updated for this organisation';
    END IF;

    INSERT INTO public.hotel_housekeeping_tasks (
      organization_id, room_id, room_label, task_type, priority, status, notes
    ) VALUES (
      NEW.organization_id, NEW.room_id, NEW.room_label, 'room_turnover', 'high', 'pending',
      'Guest checkout turnover for reservation ' || NEW.confirmation_code
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hotel_reservations_sync_room ON public.hotel_reservations;
CREATE TRIGGER hotel_reservations_sync_room
AFTER UPDATE OF status ON public.hotel_reservations
FOR EACH ROW
EXECUTE FUNCTION public.hotel_sync_room_and_turnover();
