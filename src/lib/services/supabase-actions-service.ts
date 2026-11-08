import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { User, ActionResult } from '../types';
import { canAccess } from '../auth/guards';
import { cleanDoctorName } from '../format';

const text = z.string().trim().min(2).max(150);

export class SupabaseActionError extends Error {
  constructor(
    message: string,
    public status = 422,
    public code = 'ACTION_ERROR',
  ) {
    super(message);
  }
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]+/gu, '')
    .slice(0, 50);
}

export async function executeSupabaseAction(
  user: User,
  action: string,
  payload: unknown,
): Promise<ActionResult<unknown>> {
  const { createSupabaseServer } = await import('../supabase/server');
  const { createSupabaseAdmin } = await import('../supabase/admin');
  const serverClient = await createSupabaseServer();
  const adminClient = createSupabaseAdmin();

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
        .parse(payload);

      const { transitionSupabaseAppointment } = await import('./supabase-booking-service');
      const result = await transitionSupabaseAppointment(b.id, b.status, b.reason);
      if (!result.success) {
        throw new SupabaseActionError(
          result.error || 'تعذر تغيير حالة الموعد.',
          result.code === 'FORBIDDEN' ? 403 : result.code === 'UNAUTHORIZED' ? 401 : 422,
          result.code || 'ACTION_ERROR',
        );
      }
      return { success: true, data: result.data };
    }

    case 'onboard': {
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
        .parse(payload);

      if (user.organizationId) {
        throw new SupabaseActionError('تم إنشاء المركز مسبقاً.', 409, 'ALREADY_EXISTS');
      }

      // 1. Resolve city
      let cityId: string | null = null;
      const { data: cityAr } = await adminClient
        .from('cities')
        .select('id')
        .eq('name_ar', b.city)
        .limit(1)
        .maybeSingle();
      cityId = cityAr?.id ?? null;

      if (!cityId) {
        const { data: cityEn } = await adminClient
          .from('cities')
          .select('id')
          .eq('name_en', b.city)
          .limit(1)
          .maybeSingle();
        cityId = cityEn?.id ?? null;
      }

      if (!cityId) {
        const newCityId = randomUUID();
        await adminClient.from('cities').insert({
          id: newCityId,
          name_ar: b.city,
          name_en: b.city,
          slug: slugify(b.city) || 'city-' + newCityId.slice(0, 6),
          timezone: 'Asia/Damascus',
          is_active: true,
        });
        cityId = newCityId;
      }

      // 2. Resolve specialty
      let specialtyId: string | null = null;
      const { data: specData } = await adminClient
        .from('specialties')
        .select('id')
        .eq('name_ar', 'الطب العام')
        .limit(1)
        .maybeSingle();
      specialtyId = specData?.id ?? null;

      if (!specialtyId) {
        const { data: anySpec } = await adminClient
          .from('specialties')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (anySpec?.id) {
          specialtyId = anySpec.id;
        } else {
          const newSpecId = randomUUID();
          await adminClient.from('specialties').insert({
            id: newSpecId,
            name_ar: 'الطب العام',
            name_en: 'General Medicine',
            slug: 'general-' + newSpecId.slice(0, 6),
            icon_name: 'Stethoscope',
            is_active: true,
          });
          specialtyId = newSpecId;
        }
      }

      const orgId = randomUUID();
      const clinicId = randomUUID();
      const orgSlug = `${slugify(b.name)}-${orgId.slice(0, 8)}`;
      const clinicSlug = `${slugify(b.name)}-main-${clinicId.slice(0, 8)}`;

      // 3. Upsert user first to satisfy organizations.owner_id foreign key constraint
      await adminClient.from('users').upsert({
        id: user.id,
        email: user.email,
        role: 'clinic_owner',
        full_name: user.name || b.name,
        status: 'active',
        updated_at: new Date().toISOString(),
      });

      const { error: orgErr } = await adminClient.from('organizations').insert({
        id: orgId,
        name: b.name,
        slug: orgSlug,
        owner_id: user.id,
        tax_or_license_number: b.license,
        verification_status: 'pending',
        is_active: true,
      });

      if (orgErr) {
        throw new SupabaseActionError(
          orgErr.message || 'تعذر إنشاء المركز الطبي.',
          500,
          'DB_ERROR',
        );
      }

      await adminClient.from('subscriptions').insert({
        organization_id: orgId,
        tier: b.tier,
        status: 'trialing',
        max_doctors: b.tier === 'clinic_pro' ? 10 : 1,
        max_clinics: b.tier === 'clinic_pro' ? 3 : 1,
        booking_horizon_days: 30,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 14 * 86400000).toISOString(),
      });

      await adminClient.from('clinics').insert({
        id: clinicId,
        organization_id: orgId,
        city_id: cityId,
        name: 'الفرع الرئيسي',
        slug: clinicSlug,
        district: b.district,
        address: b.district,
        phone: b.phone,
        timezone: 'Asia/Damascus',
        cancel_window_hours: 2,
        pending_expiry_hours: 12,
        min_lead_minutes: 60,
        auto_confirm_bookings: false,
        is_active: true,
      });

      await adminClient.from('doctors').upsert({
        id: user.id,
        organization_id: orgId,
        specialty_id: specialtyId,
        license_number: b.license,
        title_ar: 'طبيب عام',
        bio_ar: 'طبيب معتمد، رعاية أولية واستشارات طبية شاملة.',
        consultation_fee: 25,
        follow_up_fee: 15,
        verification_status: 'pending',
        is_listed_publicly: false,
      });

      await adminClient.from('organization_members').insert({
        organization_id: orgId,
        clinic_id: clinicId,
        user_id: user.id,
        member_role: 'owner',
        is_active: true,
      });

      await adminClient.from('audit_logs').insert({
        organization_id: orgId,
        actor_id: user.id,
        action: 'organization.created',
        entity_type: 'organization',
        entity_id: orgId,
      });

      try {
        const { put } = await import('../demo-db');
        put('user', user.id, {
          ...user,
          name: user.name || b.name,
          organizationId: orgId,
          clinicId,
          role: 'clinic_owner',
        });
      } catch {
        // demo-db mirror is best-effort
      }

      return { success: true, data: { id: orgId, clinicId } };
    }

    case 'payment': {
      const b = z.object({ id: text }).parse(payload);
      if (!['doctor', 'receptionist', 'clinic_owner', 'super_admin'].includes(user.role)) {
        throw new SupabaseActionError('غير مصرح لك بتنفيذ هذا الإجراء.', 403, 'FORBIDDEN');
      }

      const { data: appt, error: fetchErr } = await adminClient
        .from('appointments')
        .select('id, organization_id, clinic_id, doctor_id, patient_id, status, payment_status')
        .eq('id', b.id)
        .maybeSingle();

      if (fetchErr || !appt) {
        throw new SupabaseActionError('الموعد غير موجود.', 404, 'NOT_FOUND');
      }

      const hasAccess = canAccess(
        user,
        {
          organizationId: appt.organization_id,
          doctorId: appt.doctor_id,
          clinicId: appt.clinic_id,
          patientId: appt.patient_id,
        },
        'appointment',
      );
      if (!hasAccess) {
        throw new SupabaseActionError('غير مصرح لك بتنفيذ هذا الإجراء.', 403, 'FORBIDDEN');
      }

      if (!['confirmed', 'checked_in', 'completed'].includes(appt.status)) {
        throw new SupabaseActionError('لا يمكن تحصيل كشفية موعد غير مؤكد.', 422, 'INVALID_STATE');
      }
      if (appt.payment_status !== 'unpaid') {
        throw new SupabaseActionError('الكشفية محصلة مسبقاً.', 422, 'ALREADY_PAID');
      }

      const { error: updateErr } = await adminClient
        .from('appointments')
        .update({ payment_status: 'paid_cash', updated_at: new Date().toISOString() })
        .eq('id', b.id);

      if (updateErr) {
        throw new SupabaseActionError(updateErr.message || 'تعذر تسجيل الدفع.', 500, 'DB_ERROR');
      }

      await adminClient.from('audit_logs').insert({
        organization_id: appt.organization_id,
        actor_id: user.id,
        action: 'payment.cash',
        entity_type: 'appointment',
        entity_id: b.id,
      });

      try {
        const { appointments, saveAppointment } = await import('../demo-db');
        const demoAppt = appointments().find((a) => a.id === b.id);
        if (demoAppt) {
          saveAppointment({ ...demoAppt, payment: 'paid_cash' });
        }
      } catch {
        // demo-db mirror is best-effort
      }

      return { success: true, data: { id: b.id, payment: 'paid_cash' } };
    }

    case 'medical': {
      const b = z
        .object({
          appointmentId: text,
          diagnosis: text,
          complaint: z.string().max(1000).default(''),
          notes: z.string().max(3000).default(''),
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
            .max(20)
            .default([]),
          followUp: z.string().default(''),
          visible: z.boolean().default(true),
        })
        .parse(payload);

      if (user.role !== 'doctor') {
        throw new SupabaseActionError('غير مصرح لك بتسجيل السجل الطبي.', 403, 'FORBIDDEN');
      }

      const { data: appt, error: apptErr } = await adminClient
        .from('appointments')
        .select('id, organization_id, clinic_id, doctor_id, patient_id, status')
        .eq('id', b.appointmentId)
        .maybeSingle();

      if (apptErr || !appt) {
        throw new SupabaseActionError('الموعد غير موجود.', 404, 'NOT_FOUND');
      }

      if (appt.status === 'cancelled' || appt.status === 'no_show') {
        throw new SupabaseActionError(
          'لا يمكن تسجيل استشارة لموعد ملغي أو متخلف عن الحضور.',
          422,
          'INVALID_STATE',
        );
      }

      if (appt.doctor_id !== user.id) {
        throw new SupabaseActionError(
          'غير مصرح لك بتسجيل السجل الطبي لهذا المريض.',
          403,
          'FORBIDDEN',
        );
      }

      const followUpDate =
        b.followUp && b.followUp.length >= 10 && !isNaN(Date.parse(b.followUp))
          ? b.followUp.slice(0, 10)
          : null;

      const { error: medErr } = await adminClient.from('medical_records').upsert(
        {
          appointment_id: b.appointmentId,
          organization_id: appt.organization_id,
          doctor_id: appt.doctor_id,
          patient_id: appt.patient_id,
          chief_complaint: b.complaint,
          diagnosis: b.diagnosis,
          prescription_items: b.medications,
          doctor_notes: b.notes,
          follow_up_recommended_date: followUpDate,
          is_visible_to_patient: b.visible,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'appointment_id' },
      );

      if (medErr) {
        throw new SupabaseActionError(medErr.message || 'تعذر حفظ السجل الطبي.', 500, 'DB_ERROR');
      }

      if (appt.status !== 'completed') {
        await adminClient
          .from('appointments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', b.appointmentId);
      }

      await adminClient.from('audit_logs').insert({
        organization_id: appt.organization_id,
        actor_id: user.id,
        action: 'medical.saved',
        entity_type: 'medical_record',
        entity_id: b.appointmentId,
      });

      return { success: true, data: { appointmentId: b.appointmentId } };
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
        .parse(payload);

      const isDocSelf = user.role === 'doctor' && user.id === b.doctorId;
      let targetOrgId = user.organizationId;

      if (!isDocSelf) {
        const { data: targetDoc } = await adminClient
          .from('doctors')
          .select('id, organization_id')
          .eq('id', b.doctorId)
          .maybeSingle();

        if (!targetDoc) {
          throw new SupabaseActionError('الطبيب غير موجود.', 404, 'NOT_FOUND');
        }
        targetOrgId = targetDoc.organization_id;
      }

      const isOwner = user.role === 'clinic_owner' && user.organizationId === targetOrgId;
      if (!isOwner && !isDocSelf) {
        throw new SupabaseActionError('غير مصرح لك بتعديل جدول الدوام.', 403, 'FORBIDDEN');
      }

      for (const s of b.shifts) {
        if (s.end <= s.start) {
          throw new SupabaseActionError(
            'يجب أن تكون نهاية الدوام بعد بدايته.',
            422,
            'INVALID_TIME',
          );
        }
        const hasOverlap = b.shifts.some(
          (t) =>
            t !== s &&
            t.day === s.day &&
            s.active &&
            t.active &&
            t.start < s.end &&
            t.end > s.start,
        );
        if (hasOverlap) {
          throw new SupabaseActionError('يوجد تداخل في فترات الدوام.', 422, 'OVERLAP');
        }
      }

      let clinicId = user.clinicId;
      if (!clinicId) {
        const { data: member } = await adminClient
          .from('organization_members')
          .select('clinic_id')
          .eq('user_id', b.doctorId)
          .maybeSingle();
        clinicId = member?.clinic_id;
      }
      if (!clinicId) {
        const { data: docClinic } = await adminClient
          .from('clinics')
          .select('id')
          .eq('organization_id', user.organizationId ?? '')
          .limit(1)
          .maybeSingle();
        clinicId = docClinic?.id;
      }

      if (!clinicId) {
        throw new SupabaseActionError('العيادة غير محددة لتسجيل الدوام.', 422, 'MISSING_CLINIC');
      }

      await adminClient.from('availability').delete().eq('doctor_id', b.doctorId);

      const activeShifts = b.shifts.filter((s) => s.active);
      if (activeShifts.length > 0) {
        const rows = activeShifts.map((s) => ({
          doctor_id: b.doctorId,
          clinic_id: clinicId,
          day_of_week: s.day,
          start_time: s.start,
          end_time: s.end,
          slot_duration_minutes: s.duration,
          is_active: true,
        }));
        const { error: insertErr } = await adminClient.from('availability').insert(rows);
        if (insertErr) {
          throw new SupabaseActionError(
            insertErr.message || 'تعذر تحديث جدول الدوام.',
            500,
            'DB_ERROR',
          );
        }
      }

      if (user.organizationId) {
        await adminClient.from('audit_logs').insert({
          organization_id: user.organizationId,
          actor_id: user.id,
          action: 'schedule.updated',
          entity_type: 'doctor',
          entity_id: b.doctorId,
        });
      }

      return { success: true, data: { doctorId: b.doctorId, shifts: b.shifts } };
    }

    case 'exception': {
      const b = z
        .object({
          doctorId: text,
          start: z.string().datetime(),
          end: z.string().datetime(),
          reason: text,
        })
        .parse(payload);

      const isDocSelf = user.role === 'doctor' && user.id === b.doctorId;
      let targetOrgId = user.organizationId;

      if (!isDocSelf) {
        const { data: targetDoc } = await adminClient
          .from('doctors')
          .select('id, organization_id')
          .eq('id', b.doctorId)
          .maybeSingle();

        if (!targetDoc) {
          throw new SupabaseActionError('الطبيب غير موجود.', 404, 'NOT_FOUND');
        }
        targetOrgId = targetDoc.organization_id;
      }

      const isOwner = user.role === 'clinic_owner' && user.organizationId === targetOrgId;
      if (!isOwner && !isDocSelf) {
        throw new SupabaseActionError(
          'غير مصرح لك بإضافة إجازة أو فترة استثنائية.',
          403,
          'FORBIDDEN',
        );
      }

      if (b.end <= b.start) {
        throw new SupabaseActionError('حدد فترة إجازة صالحة.', 422, 'INVALID_RANGE');
      }

      const { data: docExists } = await adminClient
        .from('doctors')
        .select('id')
        .eq('id', b.doctorId)
        .maybeSingle();

      if (!docExists) {
        throw new SupabaseActionError('الطبيب غير موجود.', 404, 'NOT_FOUND');
      }

      const { data: conflicts } = await adminClient
        .from('appointments')
        .select('id')
        .eq('doctor_id', b.doctorId)
        .in('status', ['pending', 'confirmed', 'checked_in'])
        .lt('start_at', b.end)
        .gt('end_at', b.start);

      const affected = conflicts?.length ?? 0;
      const exId = randomUUID();

      let clinicId = user.clinicId;
      if (!clinicId && user.organizationId) {
        const { data: c } = await adminClient
          .from('clinics')
          .select('id')
          .eq('organization_id', user.organizationId)
          .limit(1)
          .maybeSingle();
        clinicId = c?.id;
      }

      const { error: insErr } = await adminClient.from('availability_exceptions').insert({
        id: exId,
        doctor_id: b.doctorId,
        clinic_id: clinicId || null,
        start_at: b.start,
        end_at: b.end,
        reason: b.reason,
        created_by: user.id,
      });

      if (insErr) {
        throw new SupabaseActionError(insErr.message || 'تعذر تسجيل الإجازة.', 500, 'DB_ERROR');
      }

      if (user.organizationId) {
        await adminClient.from('audit_logs').insert({
          organization_id: user.organizationId,
          actor_id: user.id,
          action: 'exception.created',
          entity_type: 'availability_exception',
          entity_id: exId,
        });
      }

      return { success: true, data: { id: exId, affected } };
    }

    case 'team': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بإدارة فريق العمل.', 403, 'FORBIDDEN');
      }

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
        .parse(payload);

      const { data: sub } = await adminClient
        .from('subscriptions')
        .select('tier, max_doctors')
        .eq('organization_id', user.organizationId)
        .maybeSingle();

      const maxDocs = sub?.max_doctors ?? (sub?.tier === 'clinic_pro' ? 10 : 1);

      if (b.role === 'receptionist' && sub?.tier === 'solo_starter') {
        throw new SupabaseActionError(
          'حسابات الاستقبال متاحة في باقة Clinic Pro.',
          422,
          'TIER_RESTRICTION',
        );
      }

      if (b.role === 'doctor') {
        if (b.license.trim().length < 2) {
          throw new SupabaseActionError('رقم الترخيص الطبي مطلوب.', 422, 'LICENSE_REQUIRED');
        }

        const { data: existingLicense } = await adminClient
          .from('doctors')
          .select('id')
          .eq('license_number', b.license)
          .maybeSingle();

        if (existingLicense) {
          throw new SupabaseActionError('رقم الترخيص الطبي مستخدم مسبقاً.', 409, 'LICENSE_EXISTS');
        }

        const { count: docCount } = await adminClient
          .from('doctors')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', user.organizationId);

        if ((docCount ?? 0) >= maxDocs) {
          throw new SupabaseActionError(
            'وصلت إلى الحد الأقصى للأطباء في باقتك.',
            422,
            'LIMIT_REACHED',
          );
        }
      }

      const { data: existingUser } = await adminClient
        .from('users')
        .select('id')
        .eq('email', b.email)
        .maybeSingle();

      if (existingUser) {
        throw new SupabaseActionError('البريد الإلكتروني مستخدم مسبقاً.', 409, 'EMAIL_EXISTS');
      }

      const { data: authCreated, error: createAuthErr } = await adminClient.auth.admin.createUser({
        email: b.email,
        password: randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: b.name },
      });

      if (createAuthErr || !authCreated?.user) {
        throw new SupabaseActionError('تعذر إنشاء حساب العضو الجديد.', 500, 'AUTH_ERROR');
      }

      const newUserId = authCreated.user.id;
      if (b.clinicId) {
        const { data: clinicRecord } = await adminClient
          .from('clinics')
          .select('id, organization_id')
          .eq('id', b.clinicId)
          .maybeSingle();
        if (!clinicRecord || clinicRecord.organization_id !== user.organizationId) {
          throw new SupabaseActionError(
            'العيادة المحددة لا تنتمي إلى مركزك الطبي.',
            403,
            'FORBIDDEN',
          );
        }
      }
      const targetClinic = b.clinicId ?? user.clinicId ?? null;

      await adminClient.from('users').upsert({
        id: newUserId,
        email: b.email,
        full_name: b.name,
        role: b.role,
        status: 'active',
      });

      await adminClient.from('organization_members').insert({
        organization_id: user.organizationId,
        clinic_id: targetClinic,
        user_id: newUserId,
        member_role: b.role === 'doctor' ? 'doctor' : 'receptionist',
        is_active: true,
      });

      if (b.role === 'doctor') {
        let specialtyId: string | null = null;
        const { data: spec } = await adminClient
          .from('specialties')
          .select('id')
          .eq('name_ar', b.specialty)
          .limit(1)
          .maybeSingle();
        specialtyId = spec?.id ?? null;

        if (!specialtyId) {
          const { data: specEn } = await adminClient
            .from('specialties')
            .select('id')
            .eq('name_en', b.specialty)
            .limit(1)
            .maybeSingle();
          specialtyId = specEn?.id ?? null;
        }

        if (!specialtyId) {
          const { data: anySpec } = await adminClient
            .from('specialties')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (anySpec?.id) {
            specialtyId = anySpec.id;
          } else {
            const newSpecId = randomUUID();
            await adminClient.from('specialties').insert({
              id: newSpecId,
              name_ar: b.specialty,
              name_en: b.specialty,
              slug: slugify(b.specialty) || 'specialty-' + newSpecId.slice(0, 8),
              icon_name: 'Stethoscope',
              is_active: true,
            });
            specialtyId = newSpecId;
          }
        }

        await adminClient.from('doctors').insert({
          id: newUserId,
          organization_id: user.organizationId,
          specialty_id: specialtyId,
          license_number: b.license,
          title_ar: 'طبيب اختصاصي',
          consultation_fee: b.fee,
          follow_up_fee: Math.round(b.fee * 0.6),
          verification_status: 'pending',
          is_listed_publicly: false,
        });
      }

      await adminClient.from('audit_logs').insert({
        organization_id: user.organizationId,
        actor_id: user.id,
        action: 'team.member_added',
        entity_type: 'user',
        entity_id: newUserId,
      });

      return { success: true, data: { id: newUserId, email: b.email, role: b.role } };
    }

    case 'branch': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بإضافة فروع.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ name: text, city: text, district: text, phone: z.string().min(7).max(25) })
        .parse(payload);

      const { data: sub } = await adminClient
        .from('subscriptions')
        .select('tier, max_clinics')
        .eq('organization_id', user.organizationId)
        .maybeSingle();

      const maxClinics = sub?.max_clinics ?? (sub?.tier === 'clinic_pro' ? 3 : 1);

      const { count: currentClinics } = await adminClient
        .from('clinics')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', user.organizationId);

      if ((currentClinics ?? 0) >= maxClinics) {
        throw new SupabaseActionError(
          'وصلت إلى الحد الأقصى للفروع في باقتك.',
          422,
          'LIMIT_REACHED',
        );
      }

      let cityId: string | null = null;
      const { data: cityAr } = await adminClient
        .from('cities')
        .select('id')
        .eq('name_ar', b.city)
        .limit(1)
        .maybeSingle();
      cityId = cityAr?.id ?? null;

      if (!cityId) {
        const { data: cityEn } = await adminClient
          .from('cities')
          .select('id')
          .eq('name_en', b.city)
          .limit(1)
          .maybeSingle();
        cityId = cityEn?.id ?? null;
      }

      if (!cityId) {
        const newCityId = randomUUID();
        await adminClient.from('cities').insert({
          id: newCityId,
          name_ar: b.city,
          name_en: b.city,
          slug: slugify(b.city) || 'city-' + newCityId.slice(0, 6),
          timezone: 'Asia/Damascus',
          is_active: true,
        });
        cityId = newCityId;
      }

      const branchId = randomUUID();
      const slug = `${slugify(b.name)}-${branchId.slice(0, 8)}`;

      const { error: insErr } = await adminClient.from('clinics').insert({
        id: branchId,
        organization_id: user.organizationId,
        city_id: cityId,
        name: b.name,
        slug,
        district: b.district,
        address: b.district,
        phone: b.phone,
        timezone: 'Asia/Damascus',
        is_active: true,
      });

      if (insErr) {
        throw new SupabaseActionError(
          insErr.message || 'تعذر إنشاء الفرع الجديد.',
          500,
          'DB_ERROR',
        );
      }

      await adminClient.from('audit_logs').insert({
        organization_id: user.organizationId,
        actor_id: user.id,
        action: 'branch.created',
        entity_type: 'clinic',
        entity_id: branchId,
      });

      return { success: true, data: { id: branchId } };
    }

    case 'doctorFee': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بتعديل الرسوم.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ id: text, fee: z.number().min(0), followUpFee: z.number().min(0) })
        .parse(payload);

      const { data: targetDoc } = await adminClient
        .from('doctors')
        .select('id, organization_id')
        .eq('id', b.id)
        .maybeSingle();

      if (!targetDoc) {
        throw new SupabaseActionError('الطبيب غير موجود.', 404, 'NOT_FOUND');
      }

      if (targetDoc.organization_id !== user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بتعديل رسوم هذا الطبيب.', 403, 'FORBIDDEN');
      }

      const { error: updErr } = await adminClient
        .from('doctors')
        .update({
          consultation_fee: b.fee,
          follow_up_fee: b.followUpFee,
          updated_at: new Date().toISOString(),
        })
        .eq('id', b.id)
        .eq('organization_id', user.organizationId);

      if (updErr) {
        throw new SupabaseActionError(updErr.message || 'تعذر تحديث الرسوم.', 500, 'DB_ERROR');
      }

      await adminClient.from('audit_logs').insert({
        organization_id: user.organizationId,
        actor_id: user.id,
        action: 'doctor.fee_updated',
        entity_type: 'doctor',
        entity_id: b.id,
      });

      return { success: true, data: { id: b.id, fee: b.fee, followUpFee: b.followUpFee } };
    }

    case 'settings': {
      if (!['clinic_owner', 'doctor', 'super_admin'].includes(user.role) || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بتعديل إعدادات المركز.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({
          name: text,
          phone: z.string().min(7).max(25),
          address: z.string().max(300),
          cancelHours: z.number().int().min(0).max(72),
          leadMinutes: z.number().int().min(15).max(1440),
          autoConfirm: z.boolean(),
        })
        .parse(payload);

      await adminClient
        .from('organizations')
        .update({ name: b.name, updated_at: new Date().toISOString() })
        .eq('id', user.organizationId);

      await adminClient
        .from('clinics')
        .update({
          phone: b.phone,
          address: b.address,
          cancel_window_hours: b.cancelHours,
          min_lead_minutes: b.leadMinutes,
          auto_confirm_bookings: b.autoConfirm,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', user.organizationId);

      await adminClient.from('audit_logs').insert({
        organization_id: user.organizationId,
        actor_id: user.id,
        action: 'organization.updated',
        entity_type: 'organization',
        entity_id: user.organizationId,
      });

      return { success: true, data: { organizationId: user.organizationId } };
    }

    case 'review': {
      if (user.role !== 'patient') {
        throw new SupabaseActionError(
          'التقييم متاح للمرضى بعد اكتمال الزيارة فقط.',
          403,
          'FORBIDDEN',
        );
      }

      const b = z
        .object({
          appointmentId: text,
          rating: z.number().int().min(1).max(5),
          comment: z.string().max(1000),
        })
        .parse(payload);

      const { data: appt, error: apptErr } = await adminClient
        .from('appointments')
        .select('id, doctor_id, patient_id, status')
        .eq('id', b.appointmentId)
        .maybeSingle();

      if (apptErr || !appt) {
        throw new SupabaseActionError('الموعد غير موجود.', 404, 'NOT_FOUND');
      }

      if (appt.patient_id !== user.id) {
        throw new SupabaseActionError('لا يمكنك تقييم موعد مسجل لمريض آخر.', 403, 'FORBIDDEN');
      }

      if (appt.status !== 'completed') {
        throw new SupabaseActionError('التقييم متاح بعد اكتمال الزيارة فقط.', 422, 'INVALID_STATE');
      }

      const { data: existingReview } = await adminClient
        .from('reviews')
        .select('id')
        .eq('appointment_id', b.appointmentId)
        .maybeSingle();

      if (existingReview) {
        throw new SupabaseActionError('سبق أن قيّمت هذه الزيارة.', 422, 'ALREADY_REVIEWED');
      }

      const reviewId = randomUUID();
      const { error: insErr } = await adminClient.from('reviews').insert({
        id: reviewId,
        appointment_id: b.appointmentId,
        doctor_id: appt.doctor_id,
        patient_id: user.id,
        rating: b.rating,
        comment: b.comment,
        is_published: true,
      });

      if (insErr) {
        throw new SupabaseActionError(insErr.message || 'تعذر حفظ التقييم.', 500, 'DB_ERROR');
      }

      // Update doctor average
      const { data: allReviews } = await adminClient
        .from('reviews')
        .select('rating')
        .eq('doctor_id', appt.doctor_id);

      if (allReviews && allReviews.length > 0) {
        const sum = allReviews.reduce((acc, r) => acc + (r.rating || 5), 0);
        const avg = Number((sum / allReviews.length).toFixed(2));
        await adminClient
          .from('doctors')
          .update({
            rating_avg: avg,
            reviews_count: allReviews.length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appt.doctor_id);
      }

      await adminClient.from('audit_logs').insert({
        actor_id: user.id,
        action: 'review.created',
        entity_type: 'review',
        entity_id: reviewId,
      });

      return { success: true, data: { id: reviewId } };
    }

    case 'notification': {
      const b = z.object({ id: text }).parse(payload);
      await adminClient
        .from('notifications')
        .update({ is_read: true })
        .eq('id', b.id)
        .eq('user_id', user.id);

      return { success: true, data: { id: b.id } };
    }

    case 'billingRequest': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بطلب ترقية الباقة.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ tier: z.enum(['solo_starter', 'clinic_pro', 'enterprise']) })
        .parse(payload);

      await adminClient.from('audit_logs').insert({
        organization_id: user.organizationId,
        actor_id: user.id,
        action: 'billing.requested',
        entity_type: 'organization',
        entity_id: user.organizationId,
        metadata: { requested_tier: b.tier },
      });

      return { success: true, data: { organizationId: user.organizationId, tier: b.tier } };
    }

    case 'verify': {
      if (user.role !== 'super_admin') {
        throw new SupabaseActionError('غير مصرح لك باعتماد المؤسسات أو الأطباء.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({
          id: text,
          status: z.enum(['approved', 'rejected']),
          reason: z.string().max(500).default(''),
        })
        .parse(payload);

      if (b.status === 'rejected' && !b.reason.trim()) {
        throw new SupabaseActionError('سبب الرفض مطلوب عند رفض الطلب.', 422, 'REASON_REQUIRED');
      }

      // Check if ID matches an organization
      const { data: org } = await adminClient
        .from('organizations')
        .select('id')
        .eq('id', b.id)
        .maybeSingle();

      // Check if ID matches a doctor
      const { data: doc } = await adminClient
        .from('doctors')
        .select('id')
        .eq('id', b.id)
        .maybeSingle();

      if (!org && !doc) {
        throw new SupabaseActionError('الطلب غير موجود.', 404, 'NOT_FOUND');
      }

      if (org) {
        await adminClient
          .from('organizations')
          .update({ verification_status: b.status, updated_at: new Date().toISOString() })
          .eq('id', b.id);
      }

      if (doc) {
        await adminClient
          .from('doctors')
          .update({
            verification_status: b.status,
            rejection_reason: b.status === 'rejected' ? b.reason : null,
            is_listed_publicly: b.status === 'approved',
            updated_at: new Date().toISOString(),
          })
          .eq('id', b.id);
      }

      await adminClient.from('audit_logs').insert({
        actor_id: user.id,
        action: `verification.${b.status}`,
        entity_type: org ? 'organization' : 'doctor',
        entity_id: b.id,
        metadata: { reason: b.reason },
      });

      return { success: true, data: { id: b.id, status: b.status } };
    }

    case 'subscription': {
      if (user.role !== 'super_admin') {
        throw new SupabaseActionError('غير مصرح لك بتفعيل الاشتراكات.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ id: text, tier: z.enum(['solo_starter', 'clinic_pro', 'enterprise']) })
        .parse(payload);

      const { data: org } = await adminClient
        .from('organizations')
        .select('id')
        .eq('id', b.id)
        .maybeSingle();

      if (!org) {
        throw new SupabaseActionError('المؤسسة غير موجودة.', 404, 'NOT_FOUND');
      }

      const maxDocs = b.tier === 'enterprise' ? 100 : b.tier === 'clinic_pro' ? 10 : 1;
      const maxClinics = b.tier === 'enterprise' ? 100 : b.tier === 'clinic_pro' ? 3 : 1;
      const horizonDays = b.tier === 'enterprise' ? 180 : b.tier === 'clinic_pro' ? 90 : 30;

      await adminClient.from('subscriptions').upsert(
        {
          organization_id: b.id,
          tier: b.tier,
          status: 'active',
          max_doctors: maxDocs,
          max_clinics: maxClinics,
          booking_horizon_days: horizonDays,
          current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );

      await adminClient.from('audit_logs').insert({
        organization_id: b.id,
        actor_id: user.id,
        action: 'subscription.activated',
        entity_type: 'organization',
        entity_id: b.id,
        metadata: { tier: b.tier },
      });

      return { success: true, data: { id: b.id, tier: b.tier } };
    }

    case 'reference': {
      if (user.role !== 'super_admin') {
        throw new SupabaseActionError('غير مصرح لك بإضافة بيانات مرجعية.', 403, 'FORBIDDEN');
      }

      const b = z.object({ name: text, type: z.enum(['city', 'specialty']) }).parse(payload);
      const refId = randomUUID();
      const slug = slugify(b.name) || refId.slice(0, 8);

      if (b.type === 'city') {
        await adminClient.from('cities').insert({
          id: refId,
          name_ar: b.name,
          name_en: b.name,
          slug,
          timezone: 'Asia/Damascus',
          is_active: true,
        });
      } else {
        await adminClient.from('specialties').insert({
          id: refId,
          name_ar: b.name,
          name_en: b.name,
          slug,
          icon_name: 'Stethoscope',
          is_active: true,
        });
      }

      await adminClient.from('audit_logs').insert({
        actor_id: user.id,
        action: 'reference.created',
        entity_type: b.type,
        entity_id: refId,
      });

      return { success: true, data: { id: refId, name: b.name, type: b.type } };
    }

    default:
      throw new SupabaseActionError('إجراء غير معروف.', 400, 'UNKNOWN_ACTION');
  }
}
