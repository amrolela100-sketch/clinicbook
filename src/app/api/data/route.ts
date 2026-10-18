import {NextResponse} from 'next/server';
import {currentUser,demoEnabled} from '@/lib/auth/session';
import {all,get,appointments,expirePending,db} from '@/lib/demo-db';
import {canAccess} from '@/lib/auth/guards';
import type {Doctor,MedicalRecord,User} from '@/lib/types';
import type {Organization} from '@/lib/services/booking-service';
import { fetchSupabaseAppData } from '@/lib/services/supabase-data-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!demoEnabled()) {
    try {
      const data = await fetchSupabaseAppData();
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      console.error('Supabase app data fetch error:', e);
      return NextResponse.json(
        { success: false, error: 'تعذر تحميل بيانات العيادة من قاعدة البيانات السحابية.' },
        { status: 500 },
      );
    }
  }

  const user = await currentUser();
  expirePending();
 const orgs=all<Organization>('organization');
 const doctors=all<Doctor>('doctor').filter(d=>(user?.organizationId===d.organizationId)||(d.verified&&orgs.some(o=>o.id===d.organizationId&&o.status==='approved'&&['active','trialing'].includes(o.subscriptionStatus)&&new Date(o.periodEnd)>new Date()))).map(d=>{const o=orgs.find(o=>o.id===d.organizationId)!;return {...d,bookingHorizonDays:o.tier==='enterprise'?180:o.tier==='clinic_pro'?90:30,cancelHours:o.cancelHours};});
 const appts=user?appointments().filter(a=>canAccess(user,a,'appointment')):[];
 const records=user?all<MedicalRecord>('medical').filter(r=>{const a=appts.find(a=>a.id===r.appointmentId);return a&&canAccess(user,a,'medical')&&(user.role!=='patient'||r.visible);}):[];
 const staff=user?.organizationId?all<User>('user').filter(u=>u.organizationId===user.organizationId).map(({id,name,role,email,clinicId})=>({id,name,role,email,clinicId})):[];
 const data={user,doctors,appointments:appts,records,organization:user?.organizationId?get('organization',user.organizationId):null,team:staff,branches:user?.organizationId?all<{organizationId:string}>('branch').filter(b=>b.organizationId===user.organizationId):[],references:all('reference'),notifications:user?all<{organizationId:string;userId?:string}>('notification').filter(n=>n.userId===user.id||!!user.organizationId&&n.organizationId===user.organizationId):[],schedules:user?.organizationId?Object.fromEntries(doctors.filter(d=>d.organizationId===user.organizationId&&(user.role!=='doctor'||d.id===user.id)).map(d=>[d.id,get('schedule',d.id)])):{},exceptions:user?.organizationId?all<{organizationId:string}>('exception').filter(e=>e.organizationId===user.organizationId):[],reviews:all('review'),billingRequests:user?.organizationId?all<{organizationId:string}>('billingRequest').filter(r=>r.organizationId===user.organizationId):[],admin:user?.role==='super_admin'?{organizations:orgs,verifications:all('verification'),references:all('reference'),audit:db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 30').all()}:null};
 return NextResponse.json({success:true,data},{headers:{'Cache-Control':'no-store'}});
}
