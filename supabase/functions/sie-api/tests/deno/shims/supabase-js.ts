// Test stand-in for https://esm.sh/@supabase/supabase-js@2.45.4 — chat-reply.ts
// only needs the type and a createClient it never calls in these tests (the
// writer is injected).
export type SupabaseClient = any;
export function createClient(..._args: unknown[]): any {
  throw new Error("createClient must not be called in chat-reply tests — inject the clients");
}
