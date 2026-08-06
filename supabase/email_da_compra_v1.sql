-- =====================================================================
-- O E-MAIL DA COMPRA
--
-- Regra do dono (06/08/2026): "E-mails sempre devem ir para o e-mail da
-- compra, independente do e-mail antigo. Podemos, com CPF e telefone,
-- identificar uma pessoa e garantir a ela a possibilidade de ter 2
-- e-mails ou mais na base, mas as comunicações relativas a um produto
-- sempre serão com o e-mail da compra desse produto."
--
-- Três coisas faltavam para isso ser possível:
--
-- 1. A COMPRA NÃO GUARDAVA O E-MAIL. Quem comprou com um endereço novo
--    era casado pelo WhatsApp com o cadastro antigo — a pessoa certa, o
--    e-mail errado — e o endereço da compra se perdia. Só sobrevivia
--    dentro do corpo cru do webhook.
--
-- 2. O CPF CHEGAVA E ERA JOGADO FORA. A Hotmart manda o documento em
--    toda compra; a coluna existe desde a migração e estava com ZERO
--    preenchidos. É o identificador mais forte que temos.
--
-- 3. UMA PESSOA SÓ PODIA TER UM E-MAIL. A tabela de contatos tem índice
--    único por e-mail, e é bom que tenha: é o que evita a mesma pessoa
--    virar dois contatos. O que faltava era um lugar para os OUTROS
--    endereços da mesma pessoa, sem duplicar ninguém.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. a compra passa a guardar com quem ela falou
-- ------------------------------------------------------------------
alter table public.tabela_4_alunos
  add column if not exists email_compra text,
  add column if not exists documento    text;

comment on column public.tabela_4_alunos.email_compra is
  'E-mail informado NESTA compra. É para cá que vai a comunicação deste produto.';
comment on column public.tabela_4_alunos.documento is
  'CPF/documento informado nesta compra, como veio do checkout.';

create index if not exists ix_alunos_email_compra
  on public.tabela_4_alunos (lower(email_compra));

-- ------------------------------------------------------------------
-- 2. os outros e-mails da mesma pessoa
--
-- O principal continua em tabela_1_leads.email — é o que a tela mostra
-- e o que vale quando não há compra no assunto. Aqui ficam todos os
-- endereços conhecidos, com a data em que apareceram.
-- ------------------------------------------------------------------
create table if not exists public.lead_emails (
  lead_fk     uuid not null references public.tabela_1_leads(lead_id) on delete cascade,
  email       text not null,
  origem      text,
  primeiro_em timestamptz not null default now(),
  ultimo_em   timestamptz not null default now(),
  primary key (lead_fk, email)
);

comment on table public.lead_emails is
  'Todos os e-mails conhecidos de uma pessoa. O principal fica em tabela_1_leads.';

create index if not exists ix_lead_emails_email on public.lead_emails (lower(email));

alter table public.lead_emails enable row level security;

drop policy if exists lead_emails_leitura on public.lead_emails;
create policy lead_emails_leitura on public.lead_emails
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists lead_emails_escrita on public.lead_emails;
create policy lead_emails_escrita on public.lead_emails
  for all to authenticated
  using (public.papel_atual() in ('admin','terapeuta'))
  with check (public.papel_atual() in ('admin','terapeuta'));

-- ------------------------------------------------------------------
-- 3. registrar um e-mail visto, sem nunca perder o anterior
-- ------------------------------------------------------------------
create or replace function public.registrar_email_do_lead(
  p_lead uuid, p_email text, p_origem text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') = '' then return; end if;

  insert into public.lead_emails (lead_fk, email, origem)
  values (p_lead, lower(trim(p_email)), p_origem)
  on conflict (lead_fk, email) do update set ultimo_em = now();

  -- Se o contato ainda não tem e-mail nenhum, este vira o principal.
  -- Trocar um principal que já existe é decisão de gente, não de código:
  -- o endereço antigo pode ser o que a pessoa de fato lê.
  update public.tabela_1_leads
     set email = lower(trim(p_email))
   where lead_id = p_lead and coalesce(email, '') = '';
end $$;

grant execute on function public.registrar_email_do_lead(uuid, text, text)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- 4. PARA ONDE MANDAR: o e-mail da compra daquele produto
--
-- Devolve o endereço da compra mais recente do produto. Sem compra
-- (ou sem e-mail nela), cai no principal — nunca devolve vazio para
-- quem tem endereço, senão a regra viraria e-mail não enviado.
-- ------------------------------------------------------------------
create or replace function public.email_para_contato(
  p_lead uuid, p_produto text default null)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.email_compra
       from public.tabela_4_alunos c
      where c.lead_fk = p_lead
        and p_produto is not null
        and c.nome_produto ilike '%' || p_produto || '%'
        and coalesce(c.email_compra, '') <> ''
        and c.status = 'aprovada'
      order by c.data_compra desc
      limit 1),
    (select l.email from public.tabela_1_leads l where l.lead_id = p_lead)
  );
$$;

grant execute on function public.email_para_contato(uuid, text)
  to authenticated, service_role;

comment on function public.email_para_contato(uuid, text) is
  'Para onde mandar: o e-mail da compra do produto; sem isso, o principal.';

commit;
