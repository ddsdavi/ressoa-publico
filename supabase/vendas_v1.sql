-- =====================================================================
-- VENDAS — preparar a base para o relatório da Hotmart.
--
-- A tabela guardava produto, valor e forma de pagamento, mas faltavam
-- duas coisas que mudam tudo:
--
--   1. STATUS. Sem ele, um REEMBOLSO entra como venda. A pessoa que
--      pediu o dinheiro de volta apareceria no segmento "compradores" e
--      receberia a campanha de quem comprou e ficou. É o tipo de erro que
--      não dá erro — só constrangimento.
--
--   2. DATA DA COMPRA separada da data de importação. Já tropecei nisso
--      com as listas: created_at virou o dia do import e apagou o
--      histórico real. Aqui a data verdadeira tem coluna própria desde o
--      começo.
--
-- E o construtor de segmentos não sabia filtrar por compra de forma
-- alguma — nem por produto, nem por quantidade, nem por valor gasto.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. COLUNAS QUE FALTAVAM
-- ------------------------------------------------------------------
alter table public.tabela_4_alunos
  add column if not exists status text not null default 'aprovada',
  add column if not exists data_compra timestamptz,
  add column if not exists parcelas int,
  add column if not exists origem text;

alter table public.tabela_4_alunos drop constraint if exists tabela_4_alunos_status_check;
alter table public.tabela_4_alunos add constraint tabela_4_alunos_status_check
  check (status in ('aprovada','pendente','reembolsada','chargeback','cancelada','expirada'));

-- a data de importação deixa de ser a data da compra
update public.tabela_4_alunos set data_compra = created_at where data_compra is null;

-- campos que a Hotmart nem sempre traz não podem barrar a importação
alter table public.tabela_4_alunos
  alter column evento_origem drop not null,
  alter column forma_de_pagamento drop not null,
  alter column moeda set default 'BRL';

create index if not exists ix_compras_lead on public.tabela_4_alunos (lead_fk, status);
create index if not exists ix_compras_produto on public.tabela_4_alunos (nome_produto);
create index if not exists ix_compras_data on public.tabela_4_alunos (data_compra desc);

-- ------------------------------------------------------------------
-- 2. IMPORTADOR
-- Reimportar o mesmo arquivo não duplica: codigo_transacao é único, e a
-- linha existente é ATUALIZADA. É assim que um reembolso lançado depois
-- corrige a venda que já estava aqui.
-- ------------------------------------------------------------------
create or replace function public.importar_vendas(p_vendas jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_lead uuid;
  v_email text;
  v_fone text;
  v_novas int := 0;
  v_atualizadas int := 0;
  v_sem_lead int := 0;
  v_leads_novos int := 0;
begin
  for v in select * from jsonb_array_elements(p_vendas) loop
    v_email := lower(nullif(trim(v->>'email'), ''));
    v_fone := public.normalizar_whatsapp(v->>'telefone');
    v_lead := null;

    if v_fone is not null then
      select lead_id into v_lead from public.tabela_1_leads where whatsapp = v_fone limit 1;
    end if;
    if v_lead is null and v_email is not null then
      select lead_id into v_lead from public.tabela_1_leads where email = v_email limit 1;
    end if;

    -- comprador que não está na base entra: quem pagou é o contato mais
    -- valioso que existe, seria absurdo descartar por não ter se cadastrado
    if v_lead is null and v_email is not null then
      insert into public.tabela_1_leads (nome, email, whatsapp)
      values (nullif(trim(v->>'nome'), ''), v_email, v_fone)
      returning lead_id into v_lead;
      v_leads_novos := v_leads_novos + 1;
    end if;

    if v_lead is null then
      v_sem_lead := v_sem_lead + 1;
      continue;
    end if;

    insert into public.tabela_4_alunos (
      lead_fk, codigo_transacao, nome_produto, valor, moeda,
      forma_de_pagamento, status, data_compra, parcelas, evento_origem, origem)
    values (
      v_lead,
      coalesce(nullif(trim(v->>'codigo_transacao'), ''),
               md5(coalesce(v_email,'') || coalesce(v->>'produto','') || coalesce(v->>'data',''))),
      coalesce(nullif(trim(v->>'produto'), ''), 'produto sem nome'),
      coalesce((v->>'valor')::numeric, 0),
      coalesce(nullif(v->>'moeda',''), 'BRL'),
      nullif(trim(v->>'pagamento'), ''),
      coalesce(nullif(v->>'status',''), 'aprovada'),
      coalesce((v->>'data')::timestamptz, now()),
      (v->>'parcelas')::int,
      nullif(trim(v->>'evento'), ''),
      coalesce(nullif(v->>'origem',''), 'hotmart'))
    on conflict (codigo_transacao) do update
      set status = excluded.status,
          valor = excluded.valor,
          nome_produto = excluded.nome_produto,
          data_compra = excluded.data_compra,
          parcelas = excluded.parcelas;

    if found then v_atualizadas := v_atualizadas + 1; else v_novas := v_novas + 1; end if;
  end loop;

  return jsonb_build_object(
    'gravadas', v_novas + v_atualizadas,
    'leads_criados', v_leads_novos,
    'sem_email', v_sem_lead);
end $$;

grant execute on function public.importar_vendas(jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 3. RESUMO POR PESSOA — é o que responde "quem comprou mais de um"
-- ------------------------------------------------------------------
create or replace view public.compras_por_lead as
select c.lead_fk,
       count(*) filter (where c.status = 'aprovada') as compras,
       count(distinct c.nome_produto) filter (where c.status = 'aprovada') as produtos,
       coalesce(sum(c.valor) filter (where c.status = 'aprovada'), 0) as total_gasto,
       count(*) filter (where c.status in ('reembolsada','chargeback')) as devolucoes,
       max(c.data_compra) filter (where c.status = 'aprovada') as ultima_compra,
       string_agg(distinct c.nome_produto, ' · ') filter (where c.status = 'aprovada') as lista_produtos
from public.tabela_4_alunos c
group by c.lead_fk;

grant select on public.compras_por_lead to authenticated;

commit;

select (select count(*) from information_schema.columns
        where table_name='tabela_4_alunos' and column_name in ('status','data_compra','parcelas','origem')) as colunas_novas,
       (select count(*) from public.tabela_4_alunos) as compras_hoje;
