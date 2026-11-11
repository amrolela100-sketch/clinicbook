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
  const serverClient = await createSupabaseServer();

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
          result.code === 'FORBIDDEN'
            ? 403
            : result.code === 'UNAUTHORIZED'
              ? 401
              : result.code === 'NOT_FOUND'
                ? 404
                : 422,
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

      // Administrative exception: User has no organization yet; bootstrapping tenant,
      // subscription, and owner role upgrade requires service-role.
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();
      const cleanedDoctorName = cleanDoctorName(b.doctorName);
      const isSeparateDoctorEmail =
        b.email.trim().toLowerCase() !== user.email.trim().toLowerCase();

      const adminAuth = adminClient.auth?.admin as
        | {
            inviteUserByEmail?: (
              email: string,
              options?: { data?: Record<string, unknown>; redirectTo?: string },
            ) => Promise<{
              data: { user: { id: string } | null };
              error: { message?: string } | null;
            }>;
            deleteUser?: (id: string) => Promise<{ error: unknown }>;
          }
        | undefined;

      let dedicatedDoctorId: string | null = null;
      if (isSeparateDoctorEmail) {
        if (typeof adminAuth?.inviteUserByEmail !== 'function') {
          throw new SupabaseActionError(
            'خدمة دعوة الطبيب الأول غير متاحة في إعدادات المصادقة الحالية.',
            501,
            'INVITE_UNAVAILABLE',
          );
        }

        const redirectBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
        const { data: invited, error: inviteErr } = await adminAuth.inviteUserByEmail(
          b.email.trim(),
          {
            data: { full_name: cleanedDoctorName },
            ...(redirectBase ? { redirectTo: `${redirectBase}/auth/callback` } : {}),
          },
        );
        if (inviteErr || !invited?.user?.id) {
          console.error(
            '[Onboard Doctor Invitation Error]:',
            inviteErr?.message || 'Missing invited user',
          );
          throw new SupabaseActionError(
            'تعذر إرسال دعوة آمنة إلى الطبيب الأول. تحقق من إعدادات البريد ثم أعد المحاولة.',
            502,
            'INVITE_FAILED',
          );
        }
        dedicatedDoctorId = invited.user.id;
      }

      const cleanupDedicatedDoctorAuth = async () => {
        if (dedicatedDoctorId && typeof adminAuth?.deleteUser === 'function') {
          const { error } = await adminAuth.deleteUser(dedicatedDoctorId);
          if (error) {
            console.error('[Onboard Dedicated Doctor Auth Rollback Error]:', error);
          }
        }
      };

      if (typeof (adminClient as { rpc?: unknown }).rpc !== 'function') {
        await cleanupDedicatedDoctorAuth();
        throw new SupabaseActionError(
          'ترحيل إنشاء المركز الذري غير مطبق على قاعدة البيانات.',
          500,
          'MIGRATION_REQUIRED',
        );
      }

      const { data: rpcOut, error: rpcErr } = await adminClient.rpc('onboard_organization_atomic', {
        p_owner_id: user.id,
        p_owner_email: user.email,
        p_owner_name: user.name || b.name,
        p_org_name: b.name,
        p_city_name: b.city,
        p_district: b.district,
        p_phone: b.phone,
        p_license: b.license,
        p_tier: b.tier,
        p_doctor_user_id: dedicatedDoctorId,
        p_doctor_email: isSeparateDoctorEmail ? b.email.trim() : user.email,
        p_doctor_name: cleanedDoctorName,
      });

      if (rpcErr) {
        await cleanupDedicatedDoctorAuth();
        if (rpcErr.code === 'PGRST202') {
          throw new SupabaseActionError(
            'ترحيل إنشاء المركز الذري غير مطبق على قاعدة البيانات.',
            500,
            'MIGRATION_REQUIRED',
          );
        }
        if (rpcErr.code === '23505') {
          throw new SupabaseActionError(
            'المركز أو رقم الترخيص الطبي مسجل مسبقاً.',
            409,
            'ALREADY_EXISTS',
          );
        }
        if (rpcErr.code === '42501') {
          throw new SupabaseActionError('غير مصرح بإنشاء المركز.', 403, 'FORBIDDEN');
        }
        throw new SupabaseActionError(
          rpcErr.message || 'تعذر إنشاء المركز الطبي ذرياً.',
          500,
          'DB_ERROR',
        );
      }

      const row = (Array.isArray(rpcOut) ? rpcOut[0] : rpcOut) as
        { organization_id?: string; clinic_id?: string } | null | undefined;
      if (!row?.organization_id || !row?.clinic_id) {
        await cleanupDedicatedDoctorAuth();
        throw new SupabaseActionError(
          'لم تُرجع عملية إنشاء المركز معرّفات صالحة.',
          500,
          'DB_ERROR',
        );
      }

      return {
        success: true,
        data: { id: row.organization_id, clinicId: row.clinic_id },
      };
    }

    case 'payment': {
      const b = z.object({ id: text }).parse(payload);
      if (!['doctor', 'receptionist', 'clinic_owner'].includes(user.role)) {
        throw new SupabaseActionError('غير مصرح لك بتنفيذ هذا الإجراء.', 403, 'FORBIDDEN');
      }

      const { data: appt, error: fetchErr } = await serverClient
        .from('appointments')
        .select('id, organization_id, clinic_id, doctor_id, patient_id, status, payment_status')
        .eq('id', b.id)
        .maybeSingle();

      if (fetchErr) {
        throw new SupabaseActionError(
          fetchErr.message || 'تعذر جلب بيانات الموعد.',
          fetchErr.code === '42501' ? 403 : 500,
          fetchErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!appt) {
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

      const { data: updatedAppts, error: updateErr } = await serverClient
        .from('appointments')
        .update({ payment_status: 'paid_cash' })
        .eq('id', b.id)
        .select('id');

      if (updateErr) {
        throw new SupabaseActionError(
          updateErr.message || 'تعذر تسجيل الدفع.',
          updateErr.code === '42501' ? 403 : 500,
          updateErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!updatedAppts || updatedAppts.length === 0) {
        throw new SupabaseActionError('غير مصرح لك بتسجيل الدفع لهذا الموعد.', 403, 'FORBIDDEN');
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

      const { data: appt, error: apptErr } = await serverClient
        .from('appointments')
        .select('id, organization_id, clinic_id, doctor_id, patient_id, status')
        .eq('id', b.appointmentId)
        .maybeSingle();

      if (apptErr) {
        throw new SupabaseActionError(
          apptErr.message || 'تعذر جلب بيانات الموعد.',
          apptErr.code === '42501' ? 403 : 500,
          apptErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!appt) {
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

      const { error: medErr } = await serverClient.from('medical_records').upsert(
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
        throw new SupabaseActionError(
          medErr.message || 'تعذر حفظ السجل الطبي.',
          medErr.code === '42501' ? 403 : 500,
          medErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }

      if (appt.status !== 'completed') {
        const { transitionSupabaseAppointment } = await import('./supabase-booking-service');
        const transRes = await transitionSupabaseAppointment(b.appointmentId, 'completed');
        if (!transRes.success) {
          throw new SupabaseActionError(
            transRes.error || 'تعذر إتمام حالة الموعد.',
            transRes.code === 'FORBIDDEN'
              ? 403
              : transRes.code === 'UNAUTHORIZED'
                ? 401
                : transRes.code === 'NOT_FOUND'
                  ? 404
                  : 422,
            transRes.code || 'ACTION_ERROR',
          );
        }
      }

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
        const { data: targetDoc, error: targetDocError } = await serverClient
          .from('doctors')
          .select('id, organization_id')
          .eq('id', b.doctorId)
          .maybeSingle();

        if (targetDocError) {
          throw new SupabaseActionError(
            targetDocError.message || 'تعذر التحقق من الطبيب.',
            targetDocError.code === '42501' ? 403 : 500,
            targetDocError.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
          );
        }
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

      const scheduleOrgId = targetOrgId ?? user.organizationId;
      let clinicId = isDocSelf ? user.clinicId : undefined;
      if (!clinicId) {
        let memberQuery = serverClient
          .from('organization_members')
          .select('clinic_id')
          .eq('user_id', b.doctorId)
          .eq('is_active', true);
        if (scheduleOrgId) memberQuery = memberQuery.eq('organization_id', scheduleOrgId);
        const { data: member, error: memberError } = await memberQuery.maybeSingle();
        if (memberError) {
          throw new SupabaseActionError(
            memberError.message || 'تعذر تحديد فرع الطبيب.',
            memberError.code === '42501' ? 403 : 500,
            memberError.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
          );
        }
        clinicId = member?.clinic_id ?? undefined;
      }
      if (!clinicId && scheduleOrgId) {
        const { data: docClinic, error: clinicError } = await serverClient
          .from('clinics')
          .select('id')
          .eq('organization_id', scheduleOrgId)
          .limit(1)
          .maybeSingle();
        if (clinicError) {
          throw new SupabaseActionError(
            clinicError.message || 'تعذر تحديد العيادة.',
            clinicError.code === '42501' ? 403 : 500,
            clinicError.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
          );
        }
        clinicId = docClinic?.id;
      }
      if (!clinicId) {
        clinicId = user.clinicId;
      }

      if (!clinicId) {
        throw new SupabaseActionError('العيادة غير محددة لتسجيل الدوام.', 422, 'MISSING_CLINIC');
      }

      const { error: replaceErr } = await serverClient.rpc('replace_availability_atomic', {
        p_doctor_id: b.doctorId,
        p_clinic_id: clinicId,
        p_shifts: b.shifts,
      });

      if (replaceErr) {
        const message = replaceErr.message || '';
        if (replaceErr.code === '42501' || message.includes('FORBIDDEN')) {
          throw new SupabaseActionError(
            'غير مصرح لك بتعديل جدول دوام هذا الطبيب.',
            403,
            'FORBIDDEN',
          );
        }
        if (replaceErr.code === '22023') {
          const overlap = message.includes('OVERLAPPING_SHIFTS');
          throw new SupabaseActionError(
            overlap ? 'يوجد تداخل في فترات الدوام.' : 'بيانات جدول الدوام غير صالحة.',
            422,
            overlap ? 'OVERLAP' : 'INVALID_TIME',
          );
        }
        if (replaceErr.code === 'P0002' || message.includes('DOCTOR_NOT_FOUND')) {
          throw new SupabaseActionError('الطبيب غير موجود.', 404, 'NOT_FOUND');
        }
        if (replaceErr.code === 'PGRST202') {
          throw new SupabaseActionError(
            'ترحيل استبدال جدول الدوام الذري غير مطبق على قاعدة البيانات.',
            500,
            'MIGRATION_REQUIRED',
          );
        }
        console.error('[Atomic Schedule RPC Error]:', {
          code: replaceErr.code,
          message,
        });
        throw new SupabaseActionError('تعذر تحديث جدول الدوام ذرياً.', 500, 'DB_ERROR');
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
        const { data: targetDoc } = await serverClient
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

      const { data: docExists } = await serverClient
        .from('doctors')
        .select('id')
        .eq('id', b.doctorId)
        .maybeSingle();

      if (!docExists) {
        throw new SupabaseActionError('الطبيب غير موجود.', 404, 'NOT_FOUND');
      }

      const { data: conflicts } = await serverClient
        .from('appointments')
        .select('id')
        .eq('doctor_id', b.doctorId)
        .in('status', ['pending', 'confirmed', 'checked_in'])
        .lt('start_at', b.end)
        .gt('end_at', b.start);

      const affected = conflicts?.length ?? 0;
      const exId = randomUUID();

      let clinicId: string | undefined;
      const { data: member } = await serverClient
        .from('organization_members')
        .select('clinic_id')
        .eq('user_id', b.doctorId)
        .maybeSingle();
      clinicId = member?.clinic_id ?? undefined;
      if (!clinicId && isDocSelf) {
        clinicId = user.clinicId;
      }
      const exceptionOrgId = targetOrgId ?? user.organizationId;
      if (!clinicId && exceptionOrgId) {
        const { data: c } = await serverClient
          .from('clinics')
          .select('id')
          .eq('organization_id', exceptionOrgId)
          .limit(1)
          .maybeSingle();
        clinicId = c?.id;
      }
      if (!clinicId) {
        clinicId = user.clinicId;
      }

      const { error: insErr } = await serverClient.from('availability_exceptions').insert({
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

      const requestedClinicId = b.clinicId?.trim() || undefined;
      if (requestedClinicId) {
        const { data: clinicRecord, error: clinicErr } = await serverClient
          .from('clinics')
          .select('id, organization_id')
          .eq('id', requestedClinicId)
          .maybeSingle();
        if (clinicErr) {
          throw new SupabaseActionError(
            clinicErr.message || 'تعذر التحقق من العيادة.',
            clinicErr.code === '42501' ? 403 : 500,
            clinicErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
          );
        }
        if (!clinicRecord || clinicRecord.organization_id !== user.organizationId) {
          throw new SupabaseActionError(
            'العيادة المحددة لا تنتمي إلى مركزك الطبي.',
            403,
            'FORBIDDEN',
          );
        }
      }
      const targetClinic = requestedClinicId ?? user.clinicId ?? null;

      const trimmedLicense = b.license.trim();
      if (b.role === 'doctor' && trimmedLicense.length < 2) {
        throw new SupabaseActionError('رقم الترخيص الطبي مطلوب.', 422, 'LICENSE_REQUIRED');
      }

      const { data: sub, error: subErr } = await serverClient
        .from('subscriptions')
        .select('tier, max_doctors')
        .eq('organization_id', user.organizationId)
        .maybeSingle();

      if (subErr) {
        throw new SupabaseActionError(
          subErr.message || 'تعذر التحقق من باقة الاشتراك.',
          subErr.code === '42501' ? 403 : 500,
          subErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }

      const maxDocs = sub?.max_doctors ?? (sub?.tier === 'clinic_pro' ? 10 : 1);

      if (b.role === 'receptionist' && sub?.tier === 'solo_starter') {
        throw new SupabaseActionError(
          'حسابات الاستقبال متاحة في باقة Clinic Pro.',
          422,
          'TIER_RESTRICTION',
        );
      }

      if (b.role === 'doctor') {
        const { count: docCount, error: countErr } = await serverClient
          .from('doctors')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', user.organizationId);

        if (countErr) {
          throw new SupabaseActionError(
            countErr.message || 'تعذر التحقق من حد الأطباء.',
            countErr.code === '42501' ? 403 : 500,
            countErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
          );
        }

        if ((docCount ?? 0) >= maxDocs) {
          throw new SupabaseActionError(
            'وصلت إلى الحد الأقصى للأطباء في باقتك.',
            422,
            'LIMIT_REACHED',
          );
        }
      }

      // Administrative exception: Checking cross-tenant license/email uniqueness and
      // provisioning auth.users credentials for new staff members requires service-role.
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();

      if (b.role === 'doctor') {
        const { data: existingLicense, error: licErr } = await adminClient
          .from('doctors')
          .select('id')
          .eq('license_number', trimmedLicense)
          .maybeSingle();

        if (licErr) {
          throw new SupabaseActionError(
            licErr.message || 'تعذر التحقق من رقم الترخيص الطبي.',
            500,
            'DB_ERROR',
          );
        }
        if (existingLicense) {
          throw new SupabaseActionError('رقم الترخيص الطبي مستخدم مسبقاً.', 409, 'LICENSE_EXISTS');
        }
      }

      const { data: existingUser, error: userLookupErr } = await adminClient
        .from('users')
        .select('id')
        .eq('email', b.email)
        .maybeSingle();

      if (userLookupErr) {
        throw new SupabaseActionError(
          userLookupErr.message || 'تعذر التحقق من البريد الإلكتروني.',
          500,
          'DB_ERROR',
        );
      }
      if (existingUser) {
        throw new SupabaseActionError('البريد الإلكتروني مستخدم مسبقاً.', 409, 'EMAIL_EXISTS');
      }

      let newUserId: string | undefined;
      const adminAuth = adminClient.auth.admin as {
        inviteUserByEmail?: (
          email: string,
          options?: { data?: Record<string, unknown>; redirectTo?: string },
        ) => Promise<{ data: { user: { id: string } | null }; error: { message?: string } | null }>;
        createUser: (attrs: {
          email: string;
          password: string;
          email_confirm: boolean;
          user_metadata: Record<string, unknown>;
        }) => Promise<{
          data: { user: { id: string } | null };
          error: { message?: string } | null;
        }>;
        deleteUser: (id: string) => Promise<{ error: unknown }>;
      };

      if (typeof adminAuth.inviteUserByEmail === 'function') {
        const redirectBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
        const { data: invited, error: inviteErr } = await adminAuth.inviteUserByEmail(b.email, {
          data: { full_name: b.name },
          ...(redirectBase ? { redirectTo: `${redirectBase}/auth/callback` } : {}),
        });
        if (inviteErr || !invited?.user?.id) {
          console.error('[Team Invitation Error]:', inviteErr?.message || 'Missing invited user');
          throw new SupabaseActionError(
            'تعذر إرسال دعوة آمنة إلى عضو الفريق. تحقق من إعدادات البريد ثم أعد المحاولة.',
            502,
            'INVITE_FAILED',
          );
        }
        newUserId = invited.user.id;
      } else {
        if (
          process.env.NODE_ENV !== 'test' ||
          process.env.ALLOW_TEAM_PASSWORD_FALLBACK !== 'true'
        ) {
          throw new SupabaseActionError(
            'خدمة دعوات الفريق غير متاحة في إعدادات المصادقة الحالية.',
            501,
            'INVITE_UNAVAILABLE',
          );
        }
        const { data: authCreated, error: createAuthErr } = await adminAuth.createUser({
          email: b.email,
          password: randomUUID(),
          email_confirm: true,
          user_metadata: { full_name: b.name },
        });

        if (createAuthErr || !authCreated?.user) {
          throw new SupabaseActionError('تعذر إنشاء حساب العضو الجديد.', 500, 'AUTH_ERROR');
        }
        newUserId = authCreated.user.id;
      }

      const rollbackNewMember = async () => {
        const { error: authDelErr } = await adminAuth.deleteUser(newUserId!);
        if (authDelErr) {
          console.error('[Team Rollback Auth User Error]:', authDelErr);
        }
      };

      if (typeof (adminClient as { rpc?: unknown }).rpc !== 'function') {
        await rollbackNewMember();
        throw new SupabaseActionError(
          'ترحيل إضافة أعضاء الفريق الذري غير مطبق على قاعدة البيانات.',
          500,
          'MIGRATION_REQUIRED',
        );
      }

      const { data: provOut, error: provErr } = await adminClient.rpc(
        'provision_team_member_atomic',
        {
          p_actor_id: user.id,
          p_org_id: user.organizationId,
          p_clinic_id: targetClinic,
          p_new_user_id: newUserId,
          p_email: b.email,
          p_full_name: b.role === 'doctor' ? cleanDoctorName(b.name) : b.name,
          p_role: b.role,
          p_specialty_name: b.specialty,
          p_fee: b.fee,
          p_license: b.role === 'doctor' ? trimmedLicense : null,
        },
      );

      if (provErr) {
        await rollbackNewMember();
        if (provErr.code === 'PGRST202') {
          throw new SupabaseActionError(
            'ترحيل إضافة أعضاء الفريق الذري غير مطبق على قاعدة البيانات.',
            500,
            'MIGRATION_REQUIRED',
          );
        }
        if (provErr.code === 'P0008') {
          throw new SupabaseActionError(
            'حسابات الاستقبال متاحة في باقة Clinic Pro.',
            422,
            'TIER_RESTRICTION',
          );
        }
        if (provErr.code === 'P0009') {
          throw new SupabaseActionError(
            'وصلت إلى الحد الأقصى للأطباء في باقتك.',
            422,
            'LIMIT_REACHED',
          );
        }
        if (provErr.code === '23505') {
          throw new SupabaseActionError(
            'البريد الإلكتروني أو رقم الترخيص مستخدم مسبقاً.',
            409,
            'CONFLICT',
          );
        }
        if (provErr.code === '42501') {
          throw new SupabaseActionError('غير مصرح لك بإدارة فريق العمل.', 403, 'FORBIDDEN');
        }
        throw new SupabaseActionError(
          provErr.message || 'تعذر إضافة العضو الجديد ذرياً.',
          500,
          'DB_ERROR',
        );
      }

      const resolvedMemberId = typeof provOut === 'string' ? provOut : null;
      if (!resolvedMemberId) {
        await rollbackNewMember();
        throw new SupabaseActionError(
          'لم تُرجع عملية إضافة عضو الفريق معرّفاً صالحاً.',
          500,
          'DB_ERROR',
        );
      }

      return {
        success: true,
        data: { id: resolvedMemberId, email: b.email, role: b.role },
      };
    }

    case 'branch': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بإضافة فروع.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ name: text, city: text, district: text, phone: z.string().min(7).max(25) })
        .parse(payload);

      const { data: sub } = await serverClient
        .from('subscriptions')
        .select('tier, max_clinics')
        .eq('organization_id', user.organizationId)
        .maybeSingle();

      const maxClinics = sub?.max_clinics ?? (sub?.tier === 'clinic_pro' ? 3 : 1);

      const { count: currentClinics } = await serverClient
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
      const { data: cityAr } = await serverClient
        .from('cities')
        .select('id')
        .eq('name_ar', b.city)
        .limit(1)
        .maybeSingle();
      cityId = cityAr?.id ?? null;

      if (!cityId) {
        const { data: cityEn } = await serverClient
          .from('cities')
          .select('id')
          .eq('name_en', b.city)
          .limit(1)
          .maybeSingle();
        cityId = cityEn?.id ?? null;
      }

      if (!cityId) {
        // Administrative exception: Creating a new global reference city requires service-role.
        const { createSupabaseAdmin } = await import('../supabase/admin');
        const adminClient = createSupabaseAdmin();
        const newCityId = randomUUID();
        const { error: cityInsErr } = await adminClient.from('cities').insert({
          id: newCityId,
          name_ar: b.city,
          name_en: b.city,
          slug: slugify(b.city) || 'city-' + newCityId.slice(0, 6),
          timezone: 'Asia/Damascus',
          is_active: true,
        });
        if (cityInsErr) {
          throw new SupabaseActionError(
            cityInsErr.message || 'تعذر تسجيل المدينة الجديدة.',
            500,
            'DB_ERROR',
          );
        }
        cityId = newCityId;
      }

      const branchId = randomUUID();
      const slug = `${slugify(b.name)}-${branchId.slice(0, 8)}`;

      const { error: insErr } = await serverClient.from('clinics').insert({
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

      return { success: true, data: { id: branchId } };
    }

    case 'doctorFee': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بتعديل الرسوم.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ id: text, fee: z.number().min(0), followUpFee: z.number().min(0) })
        .parse(payload);

      const { data: targetDoc } = await serverClient
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

      const { data: updatedDocs, error: updErr } = await serverClient
        .from('doctors')
        .update({
          consultation_fee: b.fee,
          follow_up_fee: b.followUpFee,
        })
        .eq('id', b.id)
        .eq('organization_id', user.organizationId)
        .select('id');

      if (updErr) {
        throw new SupabaseActionError(
          updErr.message || 'تعذر تحديث الرسوم.',
          updErr.code === '42501' ? 403 : 500,
          updErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!updatedDocs || updatedDocs.length === 0) {
        throw new SupabaseActionError('غير مصرح لك بتعديل رسوم هذا الطبيب.', 403, 'FORBIDDEN');
      }

      return { success: true, data: { id: b.id, fee: b.fee, followUpFee: b.followUpFee } };
    }

    case 'settings': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
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

      const { data: updatedOrgs, error: orgUpdErr } = await serverClient
        .from('organizations')
        .update({ name: b.name })
        .eq('id', user.organizationId)
        .select('id');

      if (orgUpdErr) {
        throw new SupabaseActionError(
          orgUpdErr.message || 'تعذر تحديث اسم المركز.',
          orgUpdErr.code === '42501' ? 403 : 500,
          orgUpdErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!updatedOrgs || updatedOrgs.length === 0) {
        throw new SupabaseActionError('غير مصرح لك بتعديل إعدادات المركز.', 403, 'FORBIDDEN');
      }

      const { data: updatedClinics, error: clinicUpdErr } = await serverClient
        .from('clinics')
        .update({
          phone: b.phone,
          address: b.address,
          cancel_window_hours: b.cancelHours,
          min_lead_minutes: b.leadMinutes,
          auto_confirm_bookings: b.autoConfirm,
        })
        .eq('organization_id', user.organizationId)
        .select('id');

      if (clinicUpdErr) {
        throw new SupabaseActionError(
          clinicUpdErr.message || 'تعذر تحديث إعدادات العيادة.',
          clinicUpdErr.code === '42501' ? 403 : 500,
          clinicUpdErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!updatedClinics || updatedClinics.length === 0) {
        throw new SupabaseActionError(
          'لم يتم العثور على فرع مرتبط لتحديث إعداداته.',
          404,
          'NOT_FOUND',
        );
      }

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

      const { data: appt, error: apptErr } = await serverClient
        .from('appointments')
        .select('id, organization_id, doctor_id, patient_id, status')
        .eq('id', b.appointmentId)
        .maybeSingle();

      if (apptErr) {
        throw new SupabaseActionError(
          apptErr.message || 'تعذر جلب بيانات الموعد.',
          apptErr.code === '42501' ? 403 : 500,
          apptErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }
      if (!appt) {
        throw new SupabaseActionError('الموعد غير موجود.', 404, 'NOT_FOUND');
      }

      if (appt.patient_id !== user.id) {
        throw new SupabaseActionError('لا يمكنك تقييم موعد مسجل لمريض آخر.', 403, 'FORBIDDEN');
      }

      if (appt.status !== 'completed') {
        throw new SupabaseActionError('التقييم متاح بعد اكتمال الزيارة فقط.', 422, 'INVALID_STATE');
      }

      const { data: existingReview, error: revErr } = await serverClient
        .from('reviews')
        .select('id')
        .eq('appointment_id', b.appointmentId)
        .maybeSingle();

      if (revErr) {
        throw new SupabaseActionError(
          revErr.message || 'تعذر التحقق من وجود تقييم سابق.',
          revErr.code === '42501' ? 403 : 500,
          revErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }

      if (existingReview) {
        throw new SupabaseActionError('سبق أن قيّمت هذه الزيارة.', 422, 'ALREADY_REVIEWED');
      }

      const reviewId = randomUUID();
      const { error: insErr } = await serverClient.from('reviews').insert({
        id: reviewId,
        appointment_id: b.appointmentId,
        doctor_id: appt.doctor_id,
        patient_id: user.id,
        rating: b.rating,
        comment: b.comment,
        is_published: true,
      });

      if (insErr) {
        throw new SupabaseActionError(
          insErr.message || 'تعذر حفظ التقييم.',
          insErr.code === '42501' ? 403 : 500,
          insErr.code === '42501' ? 'FORBIDDEN' : 'DB_ERROR',
        );
      }

      // Rating aggregates and audit events are written by PostgreSQL triggers.
      return { success: true, data: { id: reviewId } };
    }

    case 'notification': {
      const b = z.object({ id: text }).parse(payload);
      const { data: updatedNotifs, error: notifErr } = await serverClient
        .from('notifications')
        .update({ is_read: true })
        .eq('id', b.id)
        .eq('user_id', user.id)
        .select('id');

      if (notifErr) {
        throw new SupabaseActionError(notifErr.message || 'تعذر تحديث الإشعار.', 500, 'DB_ERROR');
      }
      if (!updatedNotifs || updatedNotifs.length === 0) {
        throw new SupabaseActionError('الإشعار غير موجود.', 404, 'NOT_FOUND');
      }

      return { success: true, data: { id: b.id } };
    }

    case 'billingRequest': {
      if (user.role !== 'clinic_owner' || !user.organizationId) {
        throw new SupabaseActionError('غير مصرح لك بطلب ترقية الباقة.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ tier: z.enum(['solo_starter', 'clinic_pro', 'enterprise']) })
        .parse(payload);

      const { data: requestId, error: requestErr } = await serverClient.rpc(
        'request_billing_upgrade',
        {
          p_org: user.organizationId,
          p_tier: b.tier,
        },
      );
      if (requestErr) {
        if (requestErr.code === '23505') {
          throw new SupabaseActionError(
            'لديك طلب تفعيل قيد المراجعة بالفعل.',
            409,
            'ALREADY_PENDING',
          );
        }
        if (requestErr.code === '42501') {
          throw new SupabaseActionError('غير مصرح لك بطلب ترقية الباقة.', 403, 'FORBIDDEN');
        }
        if (requestErr.code === 'PGRST202') {
          throw new SupabaseActionError('ترحيل طلبات الفوترة غير مطبق.', 500, 'MIGRATION_REQUIRED');
        }
        throw new SupabaseActionError(requestErr.message || 'تعذر تسجيل الطلب.', 500, 'DB_ERROR');
      }
      if (typeof requestId !== 'string' || !requestId) {
        throw new SupabaseActionError('لم تُرجع عملية الفوترة معرّفاً صالحاً.', 500, 'DB_ERROR');
      }
      return {
        success: true,
        data: { id: requestId, organizationId: user.organizationId, tier: b.tier },
      };
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

      // Administrative exception: Cross-tenant clinic and doctor verification by super_admin requires service-role.
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();

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
        const { error: orgErr } = await adminClient
          .from('organizations')
          .update({ verification_status: b.status, updated_at: new Date().toISOString() })
          .eq('id', b.id);
        if (orgErr) {
          throw new SupabaseActionError(
            orgErr.message || 'تعذر تحديث حالة اعتماد المؤسسة.',
            500,
            'DB_ERROR',
          );
        }
      }

      if (doc) {
        const { error: docErr } = await adminClient
          .from('doctors')
          .update({
            verification_status: b.status,
            rejection_reason: b.status === 'rejected' ? b.reason : null,
            is_listed_publicly: b.status === 'approved',
            updated_at: new Date().toISOString(),
          })
          .eq('id', b.id);
        if (docErr) {
          throw new SupabaseActionError(
            docErr.message || 'تعذر تحديث حالة اعتماد الطبيب.',
            500,
            'DB_ERROR',
          );
        }
      }

      const { error: auditErr } = await adminClient.from('audit_logs').insert({
        actor_id: user.id,
        action: `verification.${b.status}`,
        source: 'server',
        entity_type: org ? 'organization' : 'doctor',
        entity_id: b.id,
        metadata: { reason: b.reason },
      });
      if (auditErr) {
        console.error('[Verify Audit Error]:', auditErr);
      }

      return { success: true, data: { id: b.id, status: b.status } };
    }

    case 'subscription': {
      if (user.role !== 'super_admin') {
        throw new SupabaseActionError('غير مصرح لك بتفعيل الاشتراكات.', 403, 'FORBIDDEN');
      }

      const b = z
        .object({ id: text, tier: z.enum(['solo_starter', 'clinic_pro', 'enterprise']) })
        .parse(payload);

      // Administrative exception: Platform billing and tier provisioning by super_admin requires service-role.
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();

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

      const { error: subErr } = await adminClient.from('subscriptions').upsert(
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
      if (subErr) {
        throw new SupabaseActionError(subErr.message || 'تعذر تفعيل الاشتراك.', 500, 'DB_ERROR');
      }

      const { error: auditErr } = await adminClient.from('audit_logs').insert({
        organization_id: b.id,
        actor_id: user.id,
        action: 'subscription.activated',
        source: 'server',
        entity_type: 'organization',
        entity_id: b.id,
        metadata: { tier: b.tier },
      });
      if (auditErr) {
        console.error('[Subscription Audit Error]:', auditErr);
      }

      return { success: true, data: { id: b.id, tier: b.tier } };
    }

    case 'reference': {
      if (user.role !== 'super_admin') {
        throw new SupabaseActionError('غير مصرح لك بإضافة بيانات مرجعية.', 403, 'FORBIDDEN');
      }

      const b = z.object({ name: text, type: z.enum(['city', 'specialty']) }).parse(payload);

      // Administrative exception: Global system dictionary management by super_admin requires service-role.
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();

      const refId = randomUUID();
      const slug = slugify(b.name) || refId.slice(0, 8);

      if (b.type === 'city') {
        const { error: cityErr } = await adminClient.from('cities').insert({
          id: refId,
          name_ar: b.name,
          name_en: b.name,
          slug,
          timezone: 'Asia/Damascus',
          is_active: true,
        });
        if (cityErr) {
          throw new SupabaseActionError(cityErr.message || 'تعذر إضافة المدينة.', 500, 'DB_ERROR');
        }
      } else {
        const { error: specErr } = await adminClient.from('specialties').insert({
          id: refId,
          name_ar: b.name,
          name_en: b.name,
          slug,
          icon_name: 'Stethoscope',
          is_active: true,
        });
        if (specErr) {
          throw new SupabaseActionError(
            specErr.message || 'تعذر إضافة التخصص الطبي.',
            500,
            'DB_ERROR',
          );
        }
      }

      const { error: auditErr } = await adminClient.from('audit_logs').insert({
        actor_id: user.id,
        action: 'reference.created',
        source: 'server',
        entity_type: b.type,
        entity_id: refId,
      });
      if (auditErr) {
        console.error('[Reference Audit Error]:', auditErr);
      }

      return { success: true, data: { id: refId, name: b.name, type: b.type } };
    }

    default:
      throw new SupabaseActionError('إجراء غير معروف.', 400, 'UNKNOWN_ACTION');
  }
}
