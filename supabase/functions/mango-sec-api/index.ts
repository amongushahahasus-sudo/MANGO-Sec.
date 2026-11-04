import { createHandler } from './service.js';

// These keys are provided only to the server runtime by Supabase.
function defaultKey(name: string): string {
  try { return JSON.parse(Deno.env.get(name) || '{}').default || ''; }
  catch { return ''; }
}

Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
  publicKey: Deno.env.get('SUPABASE_ANON_KEY') || defaultKey('SUPABASE_PUBLISHABLE_KEYS'),
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || defaultKey('SUPABASE_SECRET_KEYS'),
}));
