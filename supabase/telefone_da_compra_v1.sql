-- =====================================================================
-- O TELEFONE DA COMPRA
--
-- Ordem do dono (06/08/2026), estendendo a regra do e-mail: "Mesma regra
-- pode valer para quando a pessoa tiver mais de um celular."
--
--   Produto A -> comprado com o telefone A -> WhatsApp do produto A vai
--   para o telefone A. Produto B, telefone B.
--
-- Por que isso importa tanto quanto o e-mail: quem fundiu dois cadastros
-- passou a ter dois telefones conhecidos, e o ManyChat manda mensagem
-- para UM número. Mandar o WhatsApp da turma do Desafio para o celular
-- que a pessoa usou noutra compra, meses antes, é falar no lugar errado.
--
-- A regra é a mesma do e-mail, e o desempate também: a compra mais
-- recente daquele produto manda; sem compra, vale o telefone principal
-- do cadastro.
-- =====================================================================
begin;

alter table public.tabela_4_alunos
  add column if not exists whatsapp_compra text;

comment on column public.tabela_4_alunos.whatsapp_compra is
  'Telefone informado NESTA compra, já normalizado. É para cá que vai o WhatsApp deste produto.';

create index if not exists ix_alunos_whatsapp_compra
  on public.tabela_4_alunos (whatsapp_compra);

-- ------------------------------------------------------------------
-- todos os telefones conhecidos de uma pessoa
--
-- Espelha lead_emails. O principal continua em tabela_1_leads.whatsapp —
-- é o que a tela mostra e o que vale quando não há produto no assunto.
-- ------------------------------------------------------------------
create table if not exists public.lead_telefones (
  lead_fk     uuid not null references public.tabela_1_leads(lead_id) on delete cascade,
  whatsapp    text not null,
  origem      text,
  nome        text,
  primeiro_em timestamptz not null default now(),
  ultimo_em   timestamptz not null default now(),
  primary key (lead_fk, whatsapp)
);

comment on table public.lead_telefones is
  'Todos os telefones conhecidos de uma pessoa. O principal fica em tabela_1_leads.';

alter table public.lead_telefones enable row level security;

drop policy if exists lead_telefones_leitura on public.lead_telefones;
create policy lead_telefones_leitura on public.lead_telefones
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists lead_telefones_escrita on public.lead_telefones;
create policy lead_telefones_escrita on public.lead_telefones
  for all to authenticated
  using (public.papel_atual() in ('admin','terapeuta'))
  with check (public.papel_atual() in ('admin','terapeuta'));

create or replace function public.registrar_telefone_do_lead(
  p_lead uuid, p_whatsapp text, p_origem text default null, p_nome text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_whatsapp, '') = '' then return; end if;

  insert into public.lead_telefones (lead_fk, whatsapp, origem, nome)
  values (p_lead, trim(p_whatsapp), p_origem, nullif(trim(p_nome), ''))
  on conflict (lead_fk, whatsapp) do update
    set ultimo_em = now(),
        nome = coalesce(public.lead_telefones.nome, excluded.nome);

  -- sem telefone nenhum no cadastro, este vira o principal
  update public.tabela_1_leads
     set whatsapp = trim(p_whatsapp)
   where lead_id = p_lead and coalesce(whatsapp, '') = ''
     and not exists (select 1 from public.tabela_1_leads o
                      where o.whatsapp = trim(p_whatsapp) and o.lead_id <> p_lead);
end $$;

grant execute on function public.registrar_telefone_do_lead(uuid, text, text, text)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- PARA QUAL NÚMERO MANDAR: o telefone da compra daquele produto
-- ------------------------------------------------------------------
create or replace function public.whatsapp_para_contato(
  p_lead uuid, p_produto text default null)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.whatsapp_compra
       from public.tabela_4_alunos c
      where c.lead_fk = p_lead
        and p_produto is not null
        and c.nome_produto ilike '%' || p_produto || '%'
        and coalesce(c.whatsapp_compra, '') <> ''
        and c.status = 'aprovada'
      order by c.data_compra desc
      limit 1),
    (select l.whatsapp from public.tabela_1_leads l where l.lead_id = p_lead)
  );
$$;

grant execute on function public.whatsapp_para_contato(uuid, text)
  to authenticated, service_role;

comment on function public.whatsapp_para_contato(uuid, text) is
  'Para qual número mandar: o telefone da compra do produto; sem isso, o principal.';

-- ------------------------------------------------------------------
-- o ManyChat passa a respeitar o telefone do produto
--
-- Mesmo desenho de manychat_aplicar, com um produto opcional. Sem
-- produto, tudo se comporta como antes — nenhuma automação muda de
-- comportamento sozinha.
-- ------------------------------------------------------------------
create or replace function public.manychat_aplicar(
  p_lead uuid, p_tag text, p_criar boolean default true, p_produto text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
  v_lead record;
  v_fone text;
begin
  if coalesce(public.segredo('manychat_api_key'), '') = '' then
    return 'sem chave do ManyChat configurada';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key';
  end if;

  select email, nome, whatsapp, manychat_id into v_lead
  from public.tabela_1_leads where lead_id = p_lead;
  if not found then return 'lead não encontrado'; end if;

  -- o número da compra daquele produto manda; sem produto, o principal
  v_fone := coalesce(public.whatsapp_para_contato(p_lead, p_produto), v_lead.whatsapp);

  perform net.http_post(
    url := v_base || '/manychat',
    body := jsonb_build_object(
      'lead_id', p_lead, 'manychat_id', v_lead.manychat_id,
      'email', v_lead.email, 'nome', v_lead.nome,
      'whatsapp', v_fone, 'tag', p_tag, 'criar', p_criar),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.manychat_aplicar(uuid, text, boolean, text)
  to authenticated, service_role;

commit;
