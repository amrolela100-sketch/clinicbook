import 'server-only';
import {createClient} from '@supabase/supabase-js';
// Only for trusted jobs, onboarding and signed billing webhooks. Never import into client code.
export function createSupabaseAdmin(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error('Supabase admin is not configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
