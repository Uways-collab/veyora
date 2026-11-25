import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, BedDouble, CalendarDays, CheckCircle2, ClipboardCheck, DoorOpen, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';

type Room = { id: string; room_number: string; room_type: string; floor: string | null; nightly_rate: number; status: string; notes: string | null };
type Reservation = { id: string; confirmation_code: string; room_id: string | null; room_label: string; guest_name: string; guest_email: string | null; guest_phone: string | null; check_in: string; check_out: string; adults: number; children: number; total_amount: number; nightly_rate: number; booking_source: string; payment_status: string; status: string; notes: string | null };
type Task = { id: string; room_id: string | null; room_label: string; task_type: string; priority: string; assigned_to: string | null; due_at: string | null; status: string; notes: string | null; created_at: string };
type Tab = 'front_desk' | 'reservations' | 'rooms' | 'housekeeping';
const money = (value: number, currency: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); } catch { return value.toLocaleString() + ' ' + currency; } };
const dateLabel = (value: string) => value ? new Date(value + (value.length === 10 ? 'T12:00:00' : '')).toLocaleDateString() : '—';
const today = () => new Date().toISOString().slice(0, 10);

export function HotelWorkspaceView() {
  const { activeOrganisation, activeRole } = useAuth();
  const supabase = getSupabaseClient() as any;
  const [tab, setTab] = useState<Tab>('front_desk');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState(false);
  const [reservationForm, setReservationForm] = useState(false);
  const [taskForm, setTaskForm] = useState(false);
  const [roomDraft, setRoomDraft] = useState({ room_number: '', room_type: 'Standard', floor: '', nightly_rate: '', notes: '' });
  const [booking, setBooking] = useState({ confirmation_code: '', room_id: '', guest_name: '', guest_email: '', guest_phone: '', check_in: today(), check_out: '', adults: '1', children: '0', nightly_rate: '', total_amount: '', booking_source: 'direct', notes: '' });
  const [taskDraft, setTaskDraft] = useState({ room_id: '', task_type: 'room_cleaning', priority: 'normal', assigned_to: '', due_at: '', notes: '' });
  const canManage = ['owner', 'admin', 'manager'].includes(activeRole ?? '');
  const currency = activeOrganisation?.base_currency ?? 'NGN';

  const load = useCallback(async () => {
    if (!supabase || !activeOrganisation) { setLoading(false); return; }
    setLoading(true); setError(null);
    const org = activeOrganisation.id;
    const [roomRes, reservationRes, taskRes] = await Promise.all([
      supabase.from('hotel_rooms').select('*').eq('organization_id', org).order('room_number'),
      supabase.from('hotel_reservations').select('*').eq('organization_id', org).order('check_in', { ascending: true }).limit(500),
      supabase.from('hotel_housekeeping_tasks').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(300),
    ]);
    const firstError = roomRes.error ?? reservationRes.error ?? taskRes.error;
    if (firstError) setError('Hotel workspace could not load: ' + firstError.message);
    setRooms((roomRes.data ?? []) as Room[]);
    setReservations((reservationRes.data ?? []) as Reservation[]);
    setTasks((taskRes.data ?? []) as Task[]);
    setLoading(false);
  }, [supabase, activeOrganisation?.id]);

  useEffect(() => { void load(); }, [load]);

  const roomMap = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const activeReservations = reservations.filter((r) => ['booked', 'checked_in'].includes(r.status));
  const arrivals = reservations.filter((r) => r.check_in === today() && r.status === 'booked');
  const departures = reservations.filter((r) => r.check_out === today() && r.status === 'checked_in');
  const inHouse = reservations.filter((r) => r.status === 'checked_in');
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'inspected');
  const occupancy = rooms.length ? Math.round((rooms.filter((r) => r.status === 'occupied').length / rooms.length) * 100) : 0;

  const submitRoom = async (event: FormEvent) => {
    event.preventDefault(); if (!activeOrganisation || !canManage) return;
    setSaving(true); setError(null); setNotice(null);
    const { error: e } = await supabase.from('hotel_rooms').insert({ organization_id: activeOrganisation.id, room_number: roomDraft.room_number.trim(), room_type: roomDraft.room_type, floor: roomDraft.floor.trim() || null, nightly_rate: Number(roomDraft.nightly_rate) || 0, notes: roomDraft.notes.trim() || null });
    if (e) setError(e.code === '23505' ? 'That room number already exists.' : e.message);
    else { setNotice('Room added to your room inventory.'); setRoomForm(false); setRoomDraft({ room_number: '', room_type: 'Standard', floor: '', nightly_rate: '', notes: '' }); await load(); }
    setSaving(false);
  };

  const submitReservation = async (event: FormEvent) => {
    event.preventDefault(); if (!activeOrganisation) return;
    if (booking.check_out <= booking.check_in) { setError('Check-out must be after check-in.'); return; }
    const room = roomMap.get(booking.room_id);
    if (!room) { setError('Choose a room for this reservation.'); return; }
    setSaving(true); setError(null); setNotice(null);
    const { error: e } = await supabase.from('hotel_reservations').insert({
      organization_id: activeOrganisation.id, confirmation_code: booking.confirmation_code.trim(), room_id: room.id, room_label: room.room_number,
      guest_name: booking.guest_name.trim(), guest_email: booking.guest_email.trim() || null, guest_phone: booking.guest_phone.trim() || null,
      check_in: booking.check_in, check_out: booking.check_out, adults: Number(booking.adults), children: Number(booking.children),
      nightly_rate: Number(booking.nightly_rate || room.nightly_rate), total_amount: Number(booking.total_amount) || (Number(booking.nightly_rate || room.nightly_rate) * Math.max(1, Math.round((new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000))),
      booking_source: booking.booking_source, payment_status: 'unpaid', status: 'booked', notes: booking.notes.trim() || null,
    });
    if (e) setError(e.code === '23P01' ? 'That room already has an overlapping reservation for those dates.' : e.message);
    else { setNotice('Reservation created. The room is now scheduled for the guest dates.'); setReservationForm(false); setBooking({ confirmation_code: '', room_id: '', guest_name: '', guest_email: '', guest_phone: '', check_in: today(), check_out: '', adults: '1', children: '0', nightly_rate: '', total_amount: '', booking_source: 'direct', notes: '' }); await load(); }
    setSaving(false);
  };

  const changeReservationStatus = async (reservation: Reservation, status: string) => {
    if (!activeOrganisation || !canManage) return;
    setSaving(true); setError(null); setNotice(null);
    const { error: e } = await supabase.from('hotel_reservations').update({ status }).eq('id', reservation.id).eq('organization_id', activeOrganisation.id);
    if (e) setError(e.message);
    else {
      if (reservation.room_id && status === 'checked_in') await supabase.from('hotel_rooms').update({ status: 'occupied' }).eq('id', reservation.room_id).eq('organization_id', activeOrganisation.id);
      if (reservation.room_id && ['checked_out', 'cancelled', 'no_show'].includes(status)) {
        await supabase.from('hotel_rooms').update({ status: 'dirty' }).eq('id', reservation.room_id).eq('organization_id', activeOrganisation.id);
        if (status === 'checked_out') {
          await supabase.from('hotel_housekeeping_tasks').insert({
            organization_id: activeOrganisation.id, room_id: reservation.room_id, room_label: reservation.room_label,
            task_type: 'room_turnover', priority: 'high', status: 'pending',
            notes: 'Guest checkout turnover for reservation ' + reservation.confirmation_code,
          });
        }
      }
      setNotice(status === 'checked_in' ? 'Guest checked in. Room marked occupied.' : status === 'checked_out' ? 'Guest checked out. Room marked dirty and a turnover task was created.' : 'Reservation updated.');
      await load();
    }
    setSaving(false);
  };

  const changeRoomStatus = async (room: Room, status: string) => {
    if (!activeOrganisation || !canManage) return;
    setSaving(true); setError(null);
    const { error: e } = await supabase.from('hotel_rooms').update({ status }).eq('id', room.id).eq('organization_id', activeOrganisation.id);
    if (e) setError(e.message); else { setNotice('Room status updated.'); await load(); }
    setSaving(false);
  };

  const submitTask = async (event: FormEvent) => {
    event.preventDefault(); if (!activeOrganisation) return;
    const room = roomMap.get(taskDraft.room_id);
    if (!room) { setError('Choose a room for this task.'); return; }
    setSaving(true); setError(null);
    const { error: e } = await supabase.from('hotel_housekeeping_tasks').insert({ organization_id: activeOrganisation.id, room_id: room.id, room_label: room.room_number, task_type: taskDraft.task_type, priority: taskDraft.priority, assigned_to: taskDraft.assigned_to.trim() || null, due_at: taskDraft.due_at ? new Date(taskDraft.due_at).toISOString() : null, status: 'pending', notes: taskDraft.notes.trim() || null });
    if (e) setError(e.message); else { setNotice('Housekeeping task created.'); setTaskForm(false); setTaskDraft({ room_id: '', task_type: 'room_cleaning', priority: 'normal', assigned_to: '', due_at: '', notes: '' }); await load(); }
    setSaving(false);
  };

  const updateTask = async (task: Task, status: string) => {
    if (!activeOrganisation || !canManage) return;
    setSaving(true); const { error: e } = await supabase.from('hotel_housekeeping_tasks').update({ status }).eq('id', task.id).eq('organization_id', activeOrganisation.id);
    if (e) setError(e.message); else {
      if (task.room_id && status === 'inspected') await supabase.from('hotel_rooms').update({ status: 'available' }).eq('id', task.room_id).eq('organization_id', activeOrganisation.id);
      setNotice('Housekeeping task updated.'); await load();
    }
    setSaving(false);
  };

  if (!activeOrganisation) return null;
  const tabs: { id: Tab; label: string; icon: typeof BedDouble }[] = [
    { id: 'front_desk', label: 'Front desk', icon: DoorOpen }, { id: 'reservations', label: 'Reservations', icon: CalendarDays },
    { id: 'rooms', label: 'Rooms', icon: BedDouble }, { id: 'housekeeping', label: 'Housekeeping', icon: ClipboardCheck },
  ];
  const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10';
  return <div className="space-y-6">
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-blue-700"><BedDouble className="h-4 w-4" /> Hospitality operations</div><h1 className="font-display text-2xl font-semibold tracking-tight text-slate-950">Hotel management</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">A dedicated front desk for guest stays, room inventory, arrivals, departures and housekeeping.</p></div>
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><RefreshCw className="h-4 w-4" /> Refresh</button>
    </header>
    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[['Occupancy', occupancy + '%', rooms.length + ' rooms configured'],['Guests in house', String(inHouse.length), 'Currently checked in'],['Arrivals today', String(arrivals.length), 'Expected check-ins'],['Departures today', String(departures.length), 'Expected check-outs'],['Housekeeping queue', String(openTasks.length), 'Tasks not yet inspected']].map(([label,value,helper]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[.02]"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p><p className="mt-1 text-[11px] text-slate-500">{helper}</p></div>)}
    </div>
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-1">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={'inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold transition ' + (tab === item.id ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:text-slate-900')}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
    {loading ? <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-14 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading hotel operations…</div> : <>
      {tab === 'front_desk' && <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="text-sm font-semibold text-slate-900">Today's arrivals</h2><p className="mt-1 text-xs text-slate-500">Guests expected to check in today</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{arrivals.length}</span></div>{arrivals.length ? arrivals.map((r) => <div key={r.id} className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-0"><div><p className="text-sm font-semibold text-slate-900">{r.guest_name}</p><p className="mt-1 text-xs text-slate-500">Room {r.room_label} · {r.confirmation_code}</p></div><button disabled={!canManage || saving} onClick={() => void changeReservationStatus(r,'checked_in')} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Check in</button></div>) : <p className="p-6 text-center text-xs text-slate-500">No arrivals scheduled for today.</p>}</section>
        <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="text-sm font-semibold text-slate-900">Today's departures</h2><p className="mt-1 text-xs text-slate-500">Guests due to check out today</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{departures.length}</span></div>{departures.length ? departures.map((r) => <div key={r.id} className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-0"><div><p className="text-sm font-semibold text-slate-900">{r.guest_name}</p><p className="mt-1 text-xs text-slate-500">Room {r.room_label} · {r.confirmation_code}</p></div><button disabled={!canManage || saving} onClick={() => void changeReservationStatus(r,'checked_out')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Check out</button></div>) : <p className="p-6 text-center text-xs text-slate-500">No departures scheduled for today.</p>}</section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-2"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-700"/><h2 className="text-sm font-semibold text-slate-900">Room readiness</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{['available','occupied','dirty','maintenance'].map((status) => <div key={status} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium capitalize text-slate-500">{status.replace('_',' ')}</p><p className="mt-1 text-xl font-semibold text-slate-900">{rooms.filter((r) => r.status === status).length}</p></div>)}</div></section>
      </div>}
      {tab === 'reservations' && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="text-sm font-semibold text-slate-900">Guest reservations</h2><p className="mt-1 text-xs text-slate-500">Manage bookings, stay dates, guest details and front-desk status.</p></div><button onClick={() => setReservationForm(!reservationForm)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-2.5 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> New reservation</button></div>
        {reservationForm && <form onSubmit={(e) => void submitReservation(e)} className="grid gap-3 border-b border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs font-medium">Confirmation code<input required value={booking.confirmation_code} onChange={(e) => setBooking({...booking,confirmation_code:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Guest full name<input required value={booking.guest_name} onChange={(e) => setBooking({...booking,guest_name:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Room<select required value={booking.room_id} onChange={(e) => {const r=roomMap.get(e.target.value);setBooking({...booking,room_id:e.target.value,nightly_rate:r?String(r.nightly_rate):''});}} className={fieldClass}><option value="">Select room</option>{rooms.filter((r) => r.status === 'available').map((r) => <option key={r.id} value={r.id}>{r.room_number} · {r.room_type} ({money(Number(r.nightly_rate),currency)}/night)</option>)}</select></label>
          <label className="space-y-1 text-xs font-medium">Guest email<input type="email" value={booking.guest_email} onChange={(e) => setBooking({...booking,guest_email:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Guest phone<input value={booking.guest_phone} onChange={(e) => setBooking({...booking,guest_phone:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Booking source<select value={booking.booking_source} onChange={(e) => setBooking({...booking,booking_source:e.target.value})} className={fieldClass}><option value="direct">Direct</option><option value="phone">Phone</option><option value="walk_in">Walk-in</option><option value="online_travel_agency">Online travel agency</option><option value="corporate">Corporate</option></select></label>
          <label className="space-y-1 text-xs font-medium">Check-in<input required type="date" min={today()} value={booking.check_in} onChange={(e) => setBooking({...booking,check_in:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Check-out<input required type="date" min={booking.check_in} value={booking.check_out} onChange={(e) => setBooking({...booking,check_out:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Nightly rate<input required type="number" min="0" step=".01" value={booking.nightly_rate} onChange={(e) => setBooking({...booking,nightly_rate:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Adults<input type="number" min="1" value={booking.adults} onChange={(e) => setBooking({...booking,adults:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Children<input type="number" min="0" value={booking.children} onChange={(e) => setBooking({...booking,children:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium">Total amount (optional)<input type="number" min="0" step=".01" value={booking.total_amount} onChange={(e) => setBooking({...booking,total_amount:e.target.value})} className={fieldClass}/></label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2 lg:col-span-3">Guest notes<textarea rows={2} value={booking.notes} onChange={(e) => setBooking({...booking,notes:e.target.value})} className={fieldClass}/></label>
          <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><button type="button" onClick={() => setReservationForm(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Save reservation</button></div>
        </form>}
        <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[11px] text-slate-500"><tr>{['Confirmation','Guest','Room','Stay','Amount','Payment','Status','Action'].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{reservations.map((r) => <tr key={r.id}><td className="px-4 py-3 font-semibold text-slate-800">{r.confirmation_code}</td><td className="px-4 py-3"><p className="font-medium text-slate-800">{r.guest_name}</p><p className="text-[10px] text-slate-500">{r.guest_phone || r.guest_email || ''}</p></td><td className="px-4 py-3">{r.room_label}</td><td className="whitespace-nowrap px-4 py-3">{dateLabel(r.check_in)} – {dateLabel(r.check_out)}</td><td className="px-4 py-3">{money(Number(r.total_amount),currency)}</td><td className="px-4 py-3 capitalize">{(r.payment_status || 'unpaid').replace('_',' ')}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 capitalize">{r.status.replace('_',' ')}</span></td><td className="px-4 py-3">{canManage && r.status === 'booked' ? <button disabled={saving} onClick={() => void changeReservationStatus(r,'checked_in')} className="font-semibold text-blue-700">Check in</button> : canManage && r.status === 'checked_in' ? <button disabled={saving} onClick={() => void changeReservationStatus(r,'checked_out')} className="font-semibold text-blue-700">Check out</button> : '—'}</td></tr>)}</tbody></table></div>
        {reservations.length === 0 && <p className="p-10 text-center text-xs text-slate-500">No reservations yet. Add your first guest booking.</p>}
      </section>}
      {tab === 'rooms' && <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="text-sm font-semibold text-slate-900">Room inventory</h2><p className="mt-1 text-xs text-slate-500">Room numbers, categories, rates and readiness.</p></div><button disabled={!canManage} onClick={() => setRoomForm(!roomForm)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4"/> Add room</button></div>
        {roomForm && <form onSubmit={(e) => void submitRoom(e)} className="grid gap-3 border-b border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3"><label className="space-y-1 text-xs font-medium">Room number<input required value={roomDraft.room_number} onChange={(e) => setRoomDraft({...roomDraft,room_number:e.target.value})} className={fieldClass}/></label><label className="space-y-1 text-xs font-medium">Room type<select value={roomDraft.room_type} onChange={(e) => setRoomDraft({...roomDraft,room_type:e.target.value})} className={fieldClass}>{['Standard','Superior','Deluxe','Executive','Suite','Family','Presidential','Accessible'].map((v) => <option key={v}>{v}</option>)}</select></label><label className="space-y-1 text-xs font-medium">Floor / wing<input value={roomDraft.floor} onChange={(e) => setRoomDraft({...roomDraft,floor:e.target.value})} className={fieldClass}/></label><label className="space-y-1 text-xs font-medium">Nightly rate<input required type="number" min="0" step=".01" value={roomDraft.nightly_rate} onChange={(e) => setRoomDraft({...roomDraft,nightly_rate:e.target.value})} className={fieldClass}/></label><label className="space-y-1 text-xs font-medium sm:col-span-2">Notes<input value={roomDraft.notes} onChange={(e) => setRoomDraft({...roomDraft,notes:e.target.value})} className={fieldClass}/></label><div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><button type="button" onClick={() => setRoomForm(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white">Save room</button></div></form>}
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{rooms.map((r) => <article key={r.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between"><div><p className="text-lg font-semibold text-slate-900">Room {r.room_number}</p><p className="mt-1 text-xs text-slate-500">{r.room_type}{r.floor ? ' · ' + r.floor : ''}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold capitalize">{r.status.replace('_',' ')}</span></div><p className="mt-4 text-sm font-semibold text-slate-800">{money(Number(r.nightly_rate),currency)} <span className="text-[10px] font-normal text-slate-500">per night</span></p><div className="mt-4 flex items-center gap-2"><select disabled={!canManage || r.status === 'occupied'} value={r.status} onChange={(e) => void changeRoomStatus(r,e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2 text-xs"><option value="available">Available</option><option value="occupied">Occupied</option><option value="dirty">Dirty</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select><span className="text-[10px] text-slate-400">Room status</span></div></article>)}</div>{rooms.length === 0 && <p className="p-10 text-center text-xs text-slate-500">No rooms configured yet. Add your room inventory to begin taking reservations.</p>}</section>}
      {tab === 'housekeeping' && <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="text-sm font-semibold text-slate-900">Housekeeping board</h2><p className="mt-1 text-xs text-slate-500">Cleaning, room turnovers, inspections and maintenance follow-up.</p></div><button onClick={() => setTaskForm(!taskForm)} disabled={!canManage || rooms.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4"/> New task</button></div>
        {taskForm && <form onSubmit={(e) => void submitTask(e)} className="grid gap-3 border-b border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3"><label className="space-y-1 text-xs font-medium">Room<select required value={taskDraft.room_id} onChange={(e) => setTaskDraft({...taskDraft,room_id:e.target.value})} className={fieldClass}><option value="">Choose room</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.room_number} · {r.room_type}</option>)}</select></label><label className="space-y-1 text-xs font-medium">Task type<select value={taskDraft.task_type} onChange={(e) => setTaskDraft({...taskDraft,task_type:e.target.value})} className={fieldClass}><option value="room_cleaning">Room cleaning</option><option value="room_turnover">Guest turnover</option><option value="deep_clean">Deep cleaning</option><option value="inspection">Room inspection</option><option value="maintenance">Maintenance</option></select></label><label className="space-y-1 text-xs font-medium">Priority<select value={taskDraft.priority} onChange={(e) => setTaskDraft({...taskDraft,priority:e.target.value})} className={fieldClass}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="space-y-1 text-xs font-medium">Assigned staff<input value={taskDraft.assigned_to} onChange={(e) => setTaskDraft({...taskDraft,assigned_to:e.target.value})} placeholder="Staff name" className={fieldClass}/></label><label className="space-y-1 text-xs font-medium">Due date & time<input type="datetime-local" value={taskDraft.due_at} onChange={(e) => setTaskDraft({...taskDraft,due_at:e.target.value})} className={fieldClass}/></label><label className="space-y-1 text-xs font-medium">Instructions<input value={taskDraft.notes} onChange={(e) => setTaskDraft({...taskDraft,notes:e.target.value})} className={fieldClass}/></label><div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><button type="button" onClick={() => setTaskForm(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white">Create task</button></div></form>}
        <div className="divide-y divide-slate-100">{tasks.map((t) => <div key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold capitalize text-slate-900">{t.task_type.replaceAll('_',' ')} · Room {t.room_label}</p><span className={'rounded-full px-2 py-1 text-[10px] font-semibold capitalize ' + (t.priority === 'urgent' || t.priority === 'high' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')}>{t.priority}</span></div><p className="mt-1 text-xs text-slate-500">{t.assigned_to ? 'Assigned to ' + t.assigned_to + ' · ' : ''}{t.due_at ? 'Due ' + new Date(t.due_at).toLocaleString() : 'No due time'}{t.notes ? ' · ' + t.notes : ''}</p></div><div className="flex items-center gap-2"><span className="text-xs capitalize text-slate-500">{t.status.replace('_',' ')}</span>{canManage && t.status !== 'inspected' && <select value={t.status} onChange={(e) => void updateTask(t,e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs"><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="inspected">Inspected</option></select>}</div></div>)}</div>{tasks.length === 0 && <p className="p-10 text-center text-xs text-slate-500">No housekeeping tasks yet.</p>}</section>}
    </>}
    <p className="text-[11px] leading-5 text-slate-500">Hotel operations are scoped to {activeOrganisation.name}. Room and reservation records are protected by organisation-level access policies. Payment collection and accounting integration will be enabled only after their dedicated controls are implemented.</p>
  </div>;
}
