/* ============================================
   Diamond Lineup - Supabase client

   The publishable key is designed to ship in client code
   (row access is enforced server-side by RLS policies -
   see supabase/migrations). Env vars override the baked
   defaults so a different project can be targeted without
   a code change.
   ============================================ */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env?.VITE_SUPABASE_URL || 'https://iwcayywuheygotuwlkts.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_TRg-EoepPMKmSwttlrjpUQ_AetzpMsR';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/** Explicit callback, configurable for the canonical production origin. */
export function authRedirectURL(): string {
  return new URL(import.meta.env.VITE_APP_URL || '/', window.location.origin).href;
}
