'use client';
import {createBrowserClient} from '@supabase/ssr';
export function createSupabaseBrowser(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)throw new Error('Supabase is not configured');return createBrowserClient(url,key);}
