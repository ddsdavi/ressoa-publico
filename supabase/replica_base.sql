-- =====================================================================
-- Réplica do projeto Supabase bzgrsroerqgqixcmscno (Nome do Remetente)
-- Destino: SEU-PROJETO (conta suporte@exemplo.com)
-- Gerado em 2026-08-01 a partir do schema real do projeto de origem.
-- Estado da origem: 8 tabelas, RLS habilitado em todas, SEM policies
-- (acesso só via service role), sem triggers, sem functions.
-- =====================================================================

begin;

-- ========================= conjunto: tabela_* =========================

create table if not exists public.tabela_1_leads (
  lead_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  manychat_contact_id text,
  nome text,
  email text,
  whatsapp text not null unique,
  cpf text unique
);
comment on table public.tabela_1_leads is 'Central de leads da Nome do Remetente';

create table if not exists public.tabela_2_participacoes (
  id_tabela_2 uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_fk uuid not null references public.tabela_1_leads(lead_id) on delete cascade,
  evento_origem text not null
);
comment on table public.tabela_2_participacoes is 'Participações dos leads da Nome do Remetente';
create index if not exists idx_created_at on public.tabela_2_participacoes using btree (created_at);
create index if not exists idx_evento_origem on public.tabela_2_participacoes using btree (evento_origem);
create unique index if not exists tabela_2_participacoes_lead_fk_evento_origem_idx
  on public.tabela_2_participacoes using btree (lead_fk, evento_origem);

create table if not exists public.tabela_3_precheckout (
  id_tabela_3 uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_fk uuid not null references public.tabela_1_leads(lead_id) on delete cascade,
  produto text not null,
  evento_origem text not null
);
comment on table public.tabela_3_precheckout is 'Leads que preencheram o precheckout';
create unique index if not exists tabela_3_precheckout_lead_fk_produto_evento_origem_idx
  on public.tabela_3_precheckout using btree (lead_fk, produto, evento_origem);

create table if not exists public.tabela_4_alunos (
  id_compra uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_fk uuid not null references public.tabela_1_leads(lead_id) on delete cascade,
  evento_origem text not null,
  codigo_transacao text not null unique,
  nome_produto text not null,
  forma_de_pagamento text not null,
  moeda text not null,
  valor numeric not null
);
comment on table public.tabela_4_alunos is 'Compradores de cursos da Nome do Remetente';

-- ================= conjunto: base_antiga_tabela_* =================

create table if not exists public.base_antiga_tabela_1_leads (
  lead_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  manychat_contact_id text,
  nome text,
  email text,
  whatsapp text not null unique,
  cpf text unique
);
comment on table public.base_antiga_tabela_1_leads is 'Central de leads da Nome do Remetente';

create table if not exists public.base_antiga_tabela_2_participacoes (
  id_tabela_2 uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_fk uuid not null references public.base_antiga_tabela_1_leads(lead_id) on delete cascade,
  evento_origem text not null
);
comment on table public.base_antiga_tabela_2_participacoes is 'Participações dos leads da Nome do Remetente';
create index if not exists base_antiga_tabela_2_participacoes_created_at_idx
  on public.base_antiga_tabela_2_participacoes using btree (created_at);
create index if not exists base_antiga_tabela_2_participacoes_evento_origem_idx
  on public.base_antiga_tabela_2_participacoes using btree (evento_origem);
create unique index if not exists base_antiga_tabela_2_participacoes_lead_evento_idx
  on public.base_antiga_tabela_2_participacoes using btree (lead_fk, evento_origem);

create table if not exists public.base_antiga_tabela_3_precheckout (
  id_tabela_3 uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_fk uuid not null references public.base_antiga_tabela_1_leads(lead_id) on delete cascade,
  produto text not null,
  evento_origem text not null
);
comment on table public.base_antiga_tabela_3_precheckout is 'Leads da Nome do Remetente que preencheram o precheckout';
create unique index if not exists base_antiga_tabela_3_precheckout_lead_produto_evento_idx
  on public.base_antiga_tabela_3_precheckout using btree (lead_fk, produto, evento_origem);

create table if not exists public.base_antiga_tabela_4_alunos (
  id_compra uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_fk uuid not null references public.base_antiga_tabela_1_leads(lead_id) on delete cascade,
  evento_origem text not null,
  codigo_transacao text not null unique,
  nome_produto text not null,
  forma_de_pagamento text not null,
  moeda text not null,
  valor numeric not null
);
comment on table public.base_antiga_tabela_4_alunos is 'Compradores de cursos da Nome do Remetente';

-- ===================== RLS (igual à origem) =====================
-- RLS ligado e sem policies: tabelas acessíveis apenas via service role.

alter table public.tabela_1_leads enable row level security;
alter table public.tabela_2_participacoes enable row level security;
alter table public.tabela_3_precheckout enable row level security;
alter table public.tabela_4_alunos enable row level security;
alter table public.base_antiga_tabela_1_leads enable row level security;
alter table public.base_antiga_tabela_2_participacoes enable row level security;
alter table public.base_antiga_tabela_3_precheckout enable row level security;
alter table public.base_antiga_tabela_4_alunos enable row level security;

-- ===================== dados existentes na origem =====================
-- (1 lead de teste + 1 participação)

insert into public.tabela_1_leads (lead_id, created_at, manychat_contact_id, nome, email, whatsapp, cpf)
values ('f676fb0a-e083-41d4-bbcb-faf9d4864bcb', '2026-04-06T00:10:51.633964+00:00',
        '426652728', 'Davi Damasceno', 'socio@exemplo.com', '5561999999999', null)
on conflict (lead_id) do nothing;

insert into public.tabela_2_participacoes (id_tabela_2, created_at, lead_fk, evento_origem)
values ('1d802443-dedb-4dc0-ba7a-39c0677bce43', '2026-04-06T00:10:56.924284+00:00',
        'f676fb0a-e083-41d4-bbcb-faf9d4864bcb', 'LC_2026_04')
on conflict (id_tabela_2) do nothing;

commit;
