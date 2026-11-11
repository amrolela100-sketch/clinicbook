import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { currentUser, createSession, demoEnabled } from '@/lib/auth/session';
import { canAccess } from '@/lib/auth/guards';
import { canTransition } from '@/lib/services/appointment-lifecycle';
import { overlaps } from '@/lib/services/slots-engine';
import type { Appointment, Doctor, MedicalRecord, Shift, User } from '@/lib/types';
import type { Organization } from '@/lib/services/booking-service';
import { limitHttpRequest } from '@/lib/http-rate-limit';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';

function revalidateAppPaths() {
  try {
    revalidatePath('/workspace');
    revalidatePath('/my-appointments');
  } catch {
    // Safe fallback if called outside Next.js request context (e.g. tests)
  }
}

const text = z.string().trim().min(2).max(150);
class ActionError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
function deny(m = 'غير مصرح لك بتنفيذ هذا الإجراء.'): never {
  throw new ActionError(m, 403);
}
import { cleanDoctorName } from '@/lib/format';

function pickDoctorImage(existingDocs: Doctor[]): string {
  const usedImages = new Set(existingDocs.map((d) => d.image));
  const pool = [
    'doctor-samir.jpg',
    'doctor-1.jpg',
    'doctor-5.jpg',
    'doctor-4.jpg',
    'doctor-2.jpg',
    'doctor-3.jpg',
    'doctor-6.jpg',
  ];
  for (const img of pool) {
    if (!usedImages.has(img)) return img;
  }
  return pool[existingDocs.length % pool.length];
}

export async function POST(request: Request) {
  try {
    const rateResponse = await limitHttpRequest(
      request,
      '/api/actions',
      RATE_LIMIT_CONFIGS.actions,
    );
    if (rateResponse) return rateResponse;
    const raw = await request.json().catch(() => null);
    const envelope = z.object({ action: z.string(), payload: z.unknown() }).parse(raw);
    const p = envelope.payload;
    const action = envelope.action;

    if (!demoEnabled()) {
      const user = await currentUser();
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'يرجى تسجيل الدخول.', code: 'UNAUTHORIZED' },
          { status: 401 },
        );
      }
      const actorRate = await limitHttpRequest(
        request,
        '/api/actions:actor',
        RATE_LIMIT_CONFIGS.actionActor,
        user.id,
      );
      if (actorRate) return actorRate;

      const { executeSupabaseAction, SupabaseActionError } =
        await import('@/lib/services/supabase-actions-service');
      try {
        const result = await executeSupabaseAction(user, action, p);
        if (result.success) {
          revalidateAppPaths();
        }
        return NextResponse.json(result);
      } catch (err) {
        if (err instanceof SupabaseActionError) {
          return NextResponse.json(
            { success: false, error: err.message, code: err.code },
            { status: err.status },
          );
        }
        if (err instanceof z.ZodError) {
          return NextResponse.json(
            {
              success: false,
              error: 'تحقق من الحقول المطلوبة وصحة القيم.',
              code: 'VALIDATION_ERROR',
            },
            { status: 422 },
          );
        }
        throw err;
      }
    }

    const { all, get, put, appointments, saveAppointment, audit, db, ensureSeed } =
      await import('@/lib/demo-db');
    ensureSeed();
    let user = await currentUser();
    if (user) {
      const actorRate = await limitHttpRequest(
        request,
        '/api/actions:actor',
        RATE_LIMIT_CONFIGS.actionActor,
        user.id,
      );
      if (actorRate) return actorRate;
    }
    if (action === 'onboard') {
      if (!user) {
        throw new ActionError('يرجى تسجيل الدخول أولاً.', 401);
      }

      const b = z
        .object({
          name: text,
          city: text,
          district: text,
          phone: z.string().min(7).max(25),
          doctorName: text,
          email: z.string().email(),
          license: text,
          tier: z.enum(['solo_starter', 'clinic_pro']),
        })
        .parse(p);

      const isAuthenticated = !!user;
      const { isSupabaseConfigured } = await import('@/lib/supabase/config');
      const supabaseActive = isSupabaseConfigured();

      if (supabaseActive && isAuthenticated) {
        // ── Supabase-authenticated onboarding ──
        if (user!.organizationId) {
          throw new ActionError('تم إنشاء المركز مسبقاً.', 409);
        }

        // Check email uniqueness excluding current user
        if (
          all<User>('user').some(
            (u) => u.email?.toLowerCase() === b.email.toLowerCase() && u.id !== user!.id,
          )
        )
          throw new ActionError('هذا البريد مستخدم بالفعل.');

        const id = randomUUID(),
          did = randomUUID(),
          cid = randomUUID();

        db.transaction(() => {
          put('organization', id, {
            id,
            name: b.name,
            city: b.city,
            district: b.district,
            phone: b.phone,
            license: b.license,
            tier: b.tier,
            status: 'pending',
            subscriptionStatus: 'trialing',
            periodEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
            cancelHours: 2,
            leadMinutes: 60,
            pendingHours: 12,
            expiryMinutes: 60,
            timezone: 'Asia/Damascus',
          } satisfies Organization);
          // Update existing authenticated user (don't create new)
          put('user', user!.id, {
            ...user!,
            id: user!.id,
            name: user!.name || b.name,
            email: user!.email || b.email,
            organizationId: id,
            clinicId: cid,
            role: 'clinic_owner',
          });
          const cleanName = cleanDoctorName(b.doctorName);
          put('doctor', did, {
            id: did,
            name: cleanName,
            organizationId: id,
            clinicId: cid,
            clinic: b.name,
            city: b.city,
            district: b.district,
            specialty: 'الطب العام',
            fee: 25,
            followUpFee: 15,
            rating: 4.8,
            reviews: 12,
            experience: 10,
            bio: 'طبيب معتمد، رعاية أولية واستشارات طبية شاملة.',
            color: '#e1eeeb',
            image: pickDoctorImage(all<Doctor>('doctor')),
            verified: false,
            license: b.license,
          } satisfies Doctor);
          put('user', did, {
            id: did,
            name: cleanName,
            email: `${did}@clinicbook.demo`,
            organizationId: id,
            clinicId: cid,
            role: 'doctor',
          });
          put('verification', id, {
            id,
            name: b.name,
            type: 'مركز طبي',
            city: b.city,
            license: b.license,
            status: 'pending',
            organizationId: id,
            doctorId: did,
          });
          put('schedule', did, []);
          put('branch', cid, {
            id: cid,
            organizationId: id,
            name: 'الفرع الرئيسي',
            city: b.city,
            district: b.district,
            phone: b.phone,
          });
        })();
        // No createSession needed — user is already authenticated via Supabase
        revalidateAppPaths();
        return NextResponse.json({ success: true, data: { id, clinicId: cid } });
      }

      // ── SQLite-only (demo) onboarding — original path ──
      if (user?.organizationId) {
        throw new ActionError('تم إنشاء المركز مسبقاً.', 409);
      }

      // The owner identity comes only from the authenticated session.
      const existingUserWithEmail = all<User>('user').find(
        (u) => u.email?.toLowerCase() === b.email.toLowerCase(),
      );
      if (existingUserWithEmail && existingUserWithEmail.id !== user.id) {
        throw new ActionError('هذا البريد مستخدم بالفعل.', 409);
      }
      // currentUser() is an HTTP-safe projection. Never persist it over the
      // complete stored account, which also contains its password credentials.
      const ownerUser = get<User & { passwordHash?: string }>('user', user.id);
      if (!ownerUser) {
        throw new ActionError('يرجى تسجيل الدخول أولاً.', 401);
      }
      const ownerId = user.id;
      const ownerName = ownerUser?.name || b.name; // Keep manager's name, not doctor's name!

      const id = randomUUID(),
        did = randomUUID(),
        cid = randomUUID();
      db.transaction(() => {
        put('organization', id, {
          id,
          name: b.name,
          city: b.city,
          district: b.district,
          phone: b.phone,
          license: b.license,
          tier: b.tier,
          status: 'pending',
          subscriptionStatus: 'trialing',
          periodEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
          cancelHours: 2,
          leadMinutes: 60,
          pendingHours: 12,
          expiryMinutes: 60,
          timezone: 'Asia/Damascus',
        } satisfies Organization);
        put('user', ownerId, {
          ...(ownerUser || {}),
          id: ownerId,
          name: ownerName,
          email: b.email,
          organizationId: id,
          clinicId: cid,
          role: 'clinic_owner',
        });
        const cleanName = cleanDoctorName(b.doctorName);
        put('doctor', did, {
          id: did,
          name: cleanName,
          organizationId: id,
          clinicId: cid,
          clinic: b.name,
          city: b.city,
          district: b.district,
          specialty: 'الطب العام',
          fee: 25,
          followUpFee: 15,
          rating: 4.8,
          reviews: 12,
          experience: 10,
          bio: 'طبيب معتمد، رعاية أولية واستشارات طبية شاملة.',
          color: '#e1eeeb',
          image: pickDoctorImage(all<Doctor>('doctor')),
          verified: false,
          license: b.license,
        } satisfies Doctor);
        put('user', did, {
          id: did,
          name: cleanName,
          email: `${did}@clinicbook.demo`,
          organizationId: id,
          clinicId: cid,
          role: 'doctor',
        });
        put('verification', id, {
          id,
          name: b.name,
          type: 'مركز طبي',
          city: b.city,
          license: b.license,
          status: 'pending',
          organizationId: id,
          doctorId: did,
        });
        put('schedule', did, []);
        put('branch', cid, {
          id: cid,
          organizationId: id,
          name: 'الفرع الرئيسي',
          city: b.city,
          district: b.district,
          phone: b.phone,
        });
      })();
      await createSession(ownerId);
      revalidateAppPaths();
      return NextResponse.json({ success: true, data: { id, clinicId: cid } });
    }
    if (!user) throw new ActionError('يرجى تسجيل الدخول.', 401);
    const u: User = user;
    let org = u.organizationId ? get<Organization>('organization', u.organizationId) : undefined;
    if (!org && u.organizationId) {
      org = {
        id: u.organizationId,
        name: (u.name || 'المركز الطبي') + ' - عيادة كلينك بوك',
        city: 'دمشق',
        district: 'الشعلان',
        phone: '011-2233445',
        license: 'SY-MED-2026',
        tier: 'clinic_pro',
        status: 'approved',
        subscriptionStatus: 'active',
        periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelHours: 2,
        leadMinutes: 60,
        pendingHours: 12,
        expiryMinutes: 60,
        timezone: 'Asia/Damascus',
      };
      put('organization', u.organizationId, org);
    }
    if (u.role === 'doctor') {
      let doc = get<Doctor>('doctor', u.id);
      if (!doc) {
        doc = {
          id: u.id,
          name: cleanDoctorName(u.name),
          organizationId: u.organizationId ?? u.id,
          clinicId: u.clinicId ?? u.organizationId ?? u.id,
          clinic: org?.name ?? 'عيادة الطبيب',
          city: 'دمشق',
          district: 'الشعلان',
          specialty: 'الطب العام',
          fee: 25,
          followUpFee: 15,
          rating: 4.9,
          reviews: 24,
          experience: 12,
          bio: 'استشاري معتمد، رعاية طبية متكاملة ومتابعة دورية.',
          color: '#e1eeeb',
          image: pickDoctorImage(all<Doctor>('doctor')),
          verified: true,
          license: 'SY-MED-2026',
        };
        put('doctor', u.id, doc);
      }
    }
    let output: unknown = null;
    db.transaction(() => {
      switch (action) {
        case 'transition': {
          const b = z
            .object({
              id: text,
              status: z.enum([
                'confirmed',
                'rejected',
                'cancelled',
                'checked_in',
                'completed',
                'no_show',
              ]),
              reason: z.string().max(500).default(''),
            })
            .parse(p);
          const a = appointments().find((a) => a.id === b.id);
          if (!a || !canAccess(u, a, 'appointment')) deny();
          const o = get<Organization>('organization', a!.organizationId)!;
          const check = canTransition(a!, b.status, u.role, new Date(), o.cancelHours, b.reason);
          if (!check.success) throw new ActionError(check.error);
          saveAppointment({ ...a!, status: b.status, reason: b.reason });
          audit(u, `appointment.${b.status}`, b.id);
          break;
        }
        case 'payment': {
          const b = z.object({ id: text }).parse(p);
          let a = appointments().find((x) => x.id === b.id);
          if (!a && !demoEnabled()) {
            const now = Date.now();
            a = {
              id: b.id,
              organizationId: u.organizationId ?? '',
              clinicId: u.clinicId ?? u.organizationId ?? '',
              doctorId: u.id,
              patientId: u.id,
              patientName: 'مريض',
              phone: '',
              start: new Date(now).toISOString(),
              end: new Date(now + 30 * 60000).toISOString(),
              status: 'confirmed',
              visitType: 'first_visit',
              source: 'walk_in',
              fee: 25000,
              payment: 'unpaid',
              createdAt: new Date(now).toISOString(),
            };
            saveAppointment(a);
          }
          if (!a) deny();
          const target = a;
          if (
            !['doctor', 'receptionist', 'clinic_owner', 'super_admin'].includes(u.role) ||
            !canAccess(u, target, 'appointment')
          )
            deny();
          if (!['confirmed', 'checked_in', 'completed'].includes(target.status))
            throw new ActionError('لا يمكن تحصيل كشفية موعد غير مؤكد.');
          if (target.payment !== 'unpaid') throw new ActionError('الكشفية محصلة مسبقاً.');
          saveAppointment({ ...target, payment: 'paid_cash' });
          audit(u, 'payment.cash', b.id);
          break;
        }
        case 'medical': {
          const b = z
            .object({
              appointmentId: text,
              diagnosis: text,
              complaint: z.string().max(1000),
              notes: z.string().max(3000),
              medications: z
                .array(
                  z.object({
                    id: z.string().optional(),
                    name: text,
                    dose: text,
                    frequency: text,
                    duration: text,
                  }),
                )
                .max(20),
              followUp: z.string(),
              visible: z.boolean(),
            })
            .parse(p);
          let a = appointments().find((x) => x.id === b.appointmentId);
          if (!a && !demoEnabled()) {
            const now = Date.now();
            a = {
              id: b.appointmentId,
              organizationId: u.organizationId ?? '',
              clinicId: u.clinicId ?? u.organizationId ?? '',
              doctorId: u.id,
              patientId: u.id,
              patientName: 'مريض',
              phone: '',
              start: new Date(now).toISOString(),
              end: new Date(now + 30 * 60000).toISOString(),
              status: 'confirmed',
              visitType: 'first_visit',
              source: 'walk_in',
              fee: 25000,
              payment: 'unpaid',
              createdAt: new Date(now).toISOString(),
            };
            saveAppointment(a);
          }
          if (!a) deny();
          const target = a;
          if (u.role !== 'doctor' || !canAccess(u, target, 'medical')) deny();
          const check = canTransition(target, 'completed', u.role, new Date());
          if (!check.success && target.status !== 'completed') throw new ActionError(check.error);
          put('medical', b.appointmentId, b);
          if (target.status !== 'completed') saveAppointment({ ...target, status: 'completed' });
          audit(u, 'medical.saved', b.appointmentId);
          break;
        }
        case 'schedule': {
          const b = z
            .object({
              doctorId: text,
              shifts: z
                .array(
                  z.object({
                    day: z.number().int().min(0).max(6),
                    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                    duration: z.union([
                      z.literal(10),
                      z.literal(15),
                      z.literal(20),
                      z.literal(30),
                      z.literal(45),
                      z.literal(60),
                    ]),
                    active: z.boolean(),
                  }),
                )
                .max(21),
            })
            .parse(p);
          const d = get<Doctor>('doctor', b.doctorId);
          if (
            !d ||
            d.organizationId !== u.organizationId ||
            !(u.role === 'clinic_owner' || (u.role === 'doctor' && u.id === d.id))
          )
            deny();
          for (const s of b.shifts) {
            if (s.end <= s.start) throw new ActionError('يجب أن تكون نهاية الدوام بعد بدايته.');
            if (
              b.shifts.some(
                (t) =>
                  t !== s &&
                  t.day === s.day &&
                  s.active &&
                  t.active &&
                  t.start < s.end &&
                  t.end > s.start,
              )
            )
              throw new ActionError('يوجد تداخل في فترات الدوام.');
          }
          put('schedule', b.doctorId, b.shifts);
          audit(u, 'schedule.updated', b.doctorId);
          break;
        }
        case 'exception': {
          const b = z
            .object({
              doctorId: text,
              start: z.string().datetime(),
              end: z.string().datetime(),
              reason: text,
            })
            .parse(p);
          const d = get<Doctor>('doctor', b.doctorId);
          if (
            !d ||
            d.organizationId !== u.organizationId ||
            !(u.role === 'clinic_owner' || (u.role === 'doctor' && u.id === d.id))
          )
            deny();
          if (b.end <= b.start) throw new ActionError('حدد فترة إجازة صالحة.');
          const affected = appointments().filter(
            (a) =>
              a.doctorId === b.doctorId &&
              ['pending', 'confirmed', 'checked_in'].includes(a.status) &&
              overlaps(a, b),
          );
          const id = randomUUID();
          put('exception', id, {
            id,
            ...b,
            organizationId: u.organizationId,
            affected: affected.length,
          });
          audit(u, 'exception.created', id);
          output = { affected: affected.length };
          break;
        }
        case 'team': {
          if (u.role !== 'clinic_owner' || !org) deny();
          const b = z
            .object({
              name: text,
              email: z.string().email(),
              role: z.enum(['doctor', 'receptionist']),
              specialty: text,
              fee: z.number().min(0).max(10000),
              license: z.string().max(100).default(''),
              clinicId: z.string().optional(),
            })
            .parse(p);
          if (all<User>('user').some((x) => x.email === b.email))
            throw new ActionError('البريد الإلكتروني مستخدم مسبقاً.');
          const limit = org!.tier === 'enterprise' ? 100000 : org!.tier === 'clinic_pro' ? 10 : 1;
          if (
            b.role === 'doctor' &&
            all<Doctor>('doctor').filter((d) => d.organizationId === u.organizationId).length >=
              limit
          )
            throw new ActionError('وصلت إلى الحد الأقصى للأطباء في باقتك.');
          if (b.role === 'receptionist' && org!.tier === 'solo_starter')
            throw new ActionError('حسابات الاستقبال متاحة في Clinic Pro.');
          const branch = b.clinicId
            ? get<{ organizationId: string }>('branch', b.clinicId)
            : undefined;
          if (b.clinicId && branch?.organizationId !== u.organizationId) deny();
          if (b.role === 'doctor' && b.license.trim().length < 2)
            throw new ActionError('رقم الترخيص الطبي مطلوب.');
          const memberClinic = b.clinicId ?? u.clinicId;
          const id = randomUUID();
          put('user', id, {
            id,
            name: b.name,
            email: b.email,
            role: b.role,
            organizationId: u.organizationId,
            clinicId: memberClinic,
          });
          if (b.role === 'doctor') {
            const cleanName = cleanDoctorName(b.name);
            put('doctor', id, {
              id,
              name: cleanName,
              specialty: b.specialty,
              organizationId: u.organizationId!,
              clinicId: memberClinic!,
              clinic: org!.name,
              city: org!.city,
              district: org!.district,
              fee: b.fee,
              followUpFee: 15,
              rating: 4.8,
              reviews: 10,
              experience: 8,
              bio: 'طبيب اختصاصي معتمد، رعاية متخصصة وتشخيص دقيق.',
              color: '#e1eeeb',
              image: pickDoctorImage(all<Doctor>('doctor')),
              verified: false,
              license: b.license,
            } satisfies Doctor);
            put('schedule', id, []);
            put('verification', id, {
              id,
              name: b.name,
              type: 'طبيب اختصاصي',
              city: org!.city,
              license: b.license,
              status: 'pending',
              doctorId: id,
              organizationId: u.organizationId,
            });
          }
          audit(u, 'team.member_added', id);
          break;
        }
        case 'branch': {
          if (u.role !== 'clinic_owner' || !org) deny();
          const b = z
            .object({ name: text, city: text, district: text, phone: z.string().min(7).max(25) })
            .parse(p);
          const limit = org!.tier === 'enterprise' ? 100000 : org!.tier === 'clinic_pro' ? 3 : 1;
          if (
            all<{ organizationId: string }>('branch').filter(
              (v) => v.organizationId === u.organizationId,
            ).length >= limit
          )
            throw new ActionError('وصلت إلى الحد الأقصى للفروع في باقتك.');
          const id = randomUUID();
          put('branch', id, { id, ...b, organizationId: u.organizationId });
          audit(u, 'branch.created', id);
          break;
        }
        case 'doctorFee': {
          if (u.role !== 'clinic_owner') deny();
          const b = z
            .object({ id: text, fee: z.number().min(0), followUpFee: z.number().min(0) })
            .parse(p);
          const d = get<Doctor>('doctor', b.id);
          if (!d || d.organizationId !== u.organizationId) deny();
          put('doctor', b.id, { ...d, ...b });
          audit(u, 'doctor.fee_updated', b.id);
          break;
        }
        case 'settings': {
          if (u.role !== 'clinic_owner' || !org) deny();
          const b = z
            .object({
              name: text,
              phone: z.string().min(7).max(25),
              address: z.string().max(300),
              cancelHours: z.number().int().min(0).max(72),
              leadMinutes: z.number().int().min(15).max(1440),
              autoConfirm: z.boolean(),
            })
            .parse(p);
          put('organization', org!.id, { ...org, ...b });
          audit(u, 'organization.updated', org!.id);
          break;
        }
        case 'review': {
          const b = z
            .object({
              appointmentId: text,
              rating: z.number().int().min(1).max(5),
              comment: z.string().max(1000),
            })
            .parse(p);
          const a = appointments().find((a) => a.id === b.appointmentId);
          if (!a || u.role !== 'patient' || a.patientId !== u.id || a.status !== 'completed')
            deny();
          if (get('review', b.appointmentId)) throw new ActionError('سبق أن قيّمت هذه الزيارة.');
          put('review', b.appointmentId, {
            ...b,
            doctorId: a!.doctorId,
            name: u.name,
            createdAt: new Date().toISOString(),
          });
          const d = get<Doctor>('doctor', a!.doctorId)!;
          put('doctor', d.id, {
            ...d,
            rating: (d.rating * d.reviews + b.rating) / (d.reviews + 1),
            reviews: d.reviews + 1,
          });
          audit(u, 'review.created', b.appointmentId);
          break;
        }
        case 'notification': {
          const b = z.object({ id: text }).parse(p);
          const n = get<{ organizationId?: string; userId?: string }>('notification', b.id);
          if (
            !n ||
            !(n.userId === u.id || (u.organizationId && n.organizationId === u.organizationId))
          )
            deny();
          put('notification', b.id, { ...n, read: true });
          break;
        }
        case 'billingRequest': {
          if (u.role !== 'clinic_owner') deny();
          const b = z
            .object({ tier: z.enum(['solo_starter', 'clinic_pro', 'enterprise']) })
            .parse(p);
          const existing = all<{ organizationId: string; status: string }>('billingRequest').find(
            (x) => x.organizationId === u.organizationId && x.status === 'pending',
          );
          if (existing) throw new ActionError('لديك طلب تفعيل قيد المراجعة بالفعل.');
          const id = randomUUID();
          put('billingRequest', id, {
            id,
            ...b,
            organizationId: u.organizationId,
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
          audit(u, 'billing.requested', id);
          break;
        }
        case 'verify': {
          if (u.role !== 'super_admin') deny();
          const b = z
            .object({
              id: text,
              status: z.enum(['approved', 'rejected']),
              reason: z.string().max(500).default(''),
            })
            .parse(p);
          const v = get<{ organizationId?: string; doctorId?: string; license: string }>(
            'verification',
            b.id,
          );
          if (!v) throw new ActionError('الطلب غير موجود.');
          if (b.status === 'rejected' && !b.reason.trim())
            throw new ActionError('سبب الرفض مطلوب.');
          if (b.status === 'approved' && v.license === 'بانتظار تقديم الترخيص')
            throw new ActionError('يجب استكمال الترخيص قبل الاعتماد.');
          put('verification', b.id, { ...v, ...b });
          if (v.organizationId && (!v.doctorId || v.doctorId !== b.id)) {
            const o = get<Organization>('organization', v.organizationId);
            if (o) put('organization', v.organizationId, { ...o, status: b.status });
          }
          if (v.doctorId) {
            const d = get<Doctor>('doctor', v.doctorId);
            if (d) put('doctor', v.doctorId, { ...d, verified: b.status === 'approved' });
          }
          audit(u, 'verification.' + b.status, b.id);
          break;
        }
        case 'subscription': {
          if (u.role !== 'super_admin') deny();
          const b = z
            .object({ id: text, tier: z.enum(['solo_starter', 'clinic_pro', 'enterprise']) })
            .parse(p);
          const o = get<Organization>('organization', b.id);
          if (!o) throw new ActionError('المؤسسة غير موجودة.');
          put('organization', b.id, {
            ...o,
            tier: b.tier,
            subscriptionStatus: 'active',
            periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
          for (const r of all<{ id: string; organizationId: string; status: string }>(
            'billingRequest',
          ))
            if (r.organizationId === b.id && r.status === 'pending')
              put('billingRequest', r.id, { ...r, status: 'approved' });
          audit(u, 'subscription.activated', b.id);
          break;
        }
        case 'reference': {
          if (u.role !== 'super_admin') deny();
          const b = z.object({ name: text, type: z.enum(['city', 'specialty']) }).parse(p);
          const id = randomUUID();
          put('reference', id, { id, ...b });
          audit(u, 'reference.created', id);
          break;
        }
        default:
          throw new ActionError('إجراء غير معروف.', 400);
      }
    }).immediate();
    revalidateAppPaths();
    return NextResponse.json({ success: true, data: output });
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { success: false, error: 'تحقق من الحقول المطلوبة وصحة القيم.', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    if (e instanceof ActionError)
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    console.error('Action failed', e);
    return NextResponse.json(
      { success: false, error: 'تعذر تنفيذ الإجراء، حاول مجدداً.' },
      { status: 500 },
    );
  }
}
