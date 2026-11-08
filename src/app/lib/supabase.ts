import { createClient } from "@supabase/supabase-js";

// Values come from environment variables:
//  - on Vercel: Project → Settings → Environment Variables
//  - on your computer: a `.env` file next to package.json
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJ...
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** false when the keys are missing — the app then shows a setup message instead of a blank page */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || "https://missing-project.supabase.co",
  supabaseAnonKey || "missing-anon-key",
);
