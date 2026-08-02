-- AUTH v7 — códigos de segurança genéricos (exclusão de conta e outros atos sensíveis)
begin;

create table if not exists public.codigos_seguranca (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tipo        text not null check (tipo in ('excluir_conta','troca_email','outro')),
  codigo_hash text not null,
  dados       jsonb not null default '{}'::jsonb,
  tentativas  int not null default 0,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  cancelado   boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.codigos_seguranca enable row level security;
-- sem policy: só a Edge Function (service role) enxerga

create index if not exists idx_codigos_user_tipo
  on public.codigos_seguranca (user_id, tipo, created_at desc);

commit;
