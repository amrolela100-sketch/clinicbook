import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
export interface Slot {
  start: string;
  end: string;
}
interface Input {
  date: string;
  timezone: string;
  shifts: { start: string; end: string; duration: number }[];
  now: Date;
  leadMinutes: number;
  horizonDays: number;
  bookings: (Slot & { status: string; expiresAt?: string })[];
  exceptions: Slot[];
}
export const overlaps = (a: Slot, b: Slot) =>
  new Date(a.start) < new Date(b.end) && new Date(a.end) > new Date(b.start);
export function getAvailableSlots(input: Input): Slot[] {
  const { date, timezone, shifts, now, leadMinutes, horizonDays, bookings, exceptions } = input;
  const result: Slot[] = [];
  const seen = new Set<string>();
  for (const shift of shifts) {
    if (!Number.isFinite(shift.duration) || shift.duration < 1) continue;
    const start = fromZonedTime(`${date}T${shift.start}:00`, timezone).getTime();
    const end = fromZonedTime(`${date}T${shift.end}:00`, timezone).getTime();
    for (let t = start; t + shift.duration * 60000 <= end; t += shift.duration * 60000) {
      if (t < now.getTime() + leadMinutes * 60000 || t > now.getTime() + horizonDays * 86400000)
        continue;
      const slot = {
        start: new Date(t).toISOString(),
        end: new Date(t + shift.duration * 60000).toISOString(),
      };
      if (formatInTimeZone(new Date(t), timezone, 'yyyy-MM-dd') !== date) continue;
      if (exceptions.some((ex) => overlaps(slot, ex))) continue;
      if (
        bookings.some(
          (b) =>
            (['confirmed', 'checked_in'].includes(b.status) ||
              (b.status === 'pending' && !!b.expiresAt && new Date(b.expiresAt) > now)) &&
            overlaps(slot, b),
        )
      )
        continue;
      if (!seen.has(slot.start)) {
        result.push(slot);
        seen.add(slot.start);
      }
    }
  }
  return result.sort((a, b) => a.start.localeCompare(b.start));
}
