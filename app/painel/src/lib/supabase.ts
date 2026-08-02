import { createClient } from "@supabase/supabase-js";

// Chave PÚBLICA (anon): quem manda no acesso é o RLS + o papel do usuário logado.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
