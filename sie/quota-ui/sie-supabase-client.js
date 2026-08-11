import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0?bundle";

// نفس مشروع Supabase ومفتاح النشر المعتمدين في Mad3oom. هذا عميل أمامي فقط؛
// لا يغير إعدادات Supabase أو RLS أو أي مسار خلفي.
const SUPABASE_URL = "https://srnelrdpqkcntbgudyto.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0pvB8_xD0txjdJBkYqXMyg__jKMw71W";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: "mad3oom-sie-session",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
