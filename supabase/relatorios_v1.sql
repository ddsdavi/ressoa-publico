-- =====================================================================
-- RELATÓRIOS
--
-- Tudo agregado no banco. O painel só desenha o que chega pronto — somar
-- linha a linha no navegador é a armadilha nº 1 deste projeto: a API
-- corta em 1.000 registros e a conta sai errada sem avisar.
-- =====================================================================
begin;

-- ---- 1. crescimento da base, mês a mês ----
create or replace function public.rel_crescimento(p_meses int default 18)
returns table (mes date, novos bigint, acumulado bigint)
language sql stable security definer set search_path = public as $$
  with por_mes as (
    select date_trunc('month', created_at)::date as mes, count(*) as novos
    from public.tabela_1_leads
    where created_at > now() - (greatest(1, p_meses) || ' months')::interval
    group by 1
  )
  select mes, novos, sum(novos) over (order by mes) from por_mes order by mes
$$;

-- ---- 2. desempenho das campanhas ----
create or replace function public.rel_campanhas()
returns table (
  campanha text, quando timestamptz, enviados bigint, entregues bigint,
  abriram bigint, clicaram bigint, erros bigint, suprimidos bigint,
  taxa_abertura numeric, taxa_clique numeric)
language sql stable security definer set search_path = public as $$
  select c.nome, min(e.sent_at),
         count(*) filter (where e.status in ('sent','delivered','bounced','complained')),
         count(*) filter (where e.status = 'delivered'),
         count(distinct ev.lead_fk) filter (where ev.tipo = 'open'),
         count(distinct ev.lead_fk) filter (where ev.tipo = 'click'),
         count(*) filter (where e.status in ('bounced','complained','failed')),
         count(*) filter (where e.status = 'suppressed'),
         round(100.0 * count(distinct ev.lead_fk) filter (where ev.tipo = 'open')
               / nullif(count(*) filter (where e.status in ('sent','delivered')), 0), 1),
         round(100.0 * count(distinct ev.lead_fk) filter (where ev.tipo = 'click')
               / nullif(count(*) filter (where e.status in ('sent','delivered')), 0), 1)
  from public.campanhas c
  join public.envios e on e.campanha_fk = c.campanha_id
  left join public.eventos_email ev on ev.envio_fk = e.envio_id
  group by c.campanha_id, c.nome
  order by min(e.sent_at) desc nulls last
$$;

-- ---- 3. estatísticas de tag ----
create or replace function public.rel_tags()
returns table (tag text, leads bigint, percentual numeric,
               com_email bigint, engajados bigint, usada_em_automacao boolean)
language sql stable security definer set search_path = public as $$
  with base as (select count(*)::numeric as n from public.tabela_1_leads)
  select t.nome,
         count(lt.lead_fk),
         round(100.0 * count(lt.lead_fk) / nullif((select n from base), 0), 1),
         count(lt.lead_fk) filter (where l.email is not null),
         count(lt.lead_fk) filter (where coalesce(p.pontos, 0) >= 20),
         exists (select 1 from public.automacoes a
                 where (a.gatilho->>'tag_id')::int = t.tag_id
                 union all
                 select 1 from public.automacao_passos ap
                 where (ap.config->>'tag_id')::int = t.tag_id)
  from public.tags t
  left join public.lead_tags lt on lt.tag_fk = t.tag_id
  left join public.tabela_1_leads l on l.lead_id = lt.lead_fk
  left join public.lead_pontuacao p on p.lead_fk = lt.lead_fk
  group by t.tag_id, t.nome
  order by 2 desc
$$;

-- ---- 4. análise de um campo: quais valores aparecem e quantas vezes ----
create or replace function public.rel_campo(p_chave text, p_limite int default 25)
returns table (valor text, leads bigint, percentual numeric)
language sql stable security definer set search_path = public as $$
  with vals as (
    select la.dados ->> p_chave as v
    from public.lead_atributos la
    where coalesce(la.dados ->> p_chave, '') <> ''
  ), total as (select count(*)::numeric as n from vals)
  select v, count(*), round(100.0 * count(*) / nullif((select n from total), 0), 1)
  from vals group by v
  order by 2 desc
  limit greatest(1, least(coalesce(p_limite, 25), 200))
$$;

-- ---- 5. saúde da base: como o engajamento se distribui ----
create or replace function public.rel_engajamento()
returns table (faixa text, ordem int, leads bigint)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'Topo (40+)' as faixa, 1 as ordem, count(*) as leads
      from public.lead_pontuacao where pontos >= 40
    union all select 'Quente (20 a 39)', 2, count(*) from public.lead_pontuacao where pontos between 20 and 39
    union all select 'Morno (8 a 19)', 3, count(*) from public.lead_pontuacao where pontos between 8 and 19
    union all select 'Frio (1 a 7)', 4, count(*) from public.lead_pontuacao where pontos between 1 and 7
    union all select 'Sem pontos ou negativo', 5, count(*) from public.lead_pontuacao where pontos <= 0
  ) x order by ordem
$$;

-- ---- 6. números do topo ----
create or replace function public.rel_resumo()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'leads', (select count(*) from public.tabela_1_leads),
    'com_email', (select count(*) from public.tabela_1_leads where email is not null),
    'elegiveis', (select count(distinct l.lead_id) from public.tabela_1_leads l
                  join public.lead_listas ll on ll.lead_fk = l.lead_id and ll.status = 1
                  where l.email is not null
                    and not exists (select 1 from public.supressao s where s.email = l.email)),
    'bloqueados', (select count(*) from public.supressao),
    'listas', (select count(*) from public.listas),
    'tags', (select count(*) from public.tags),
    'automacoes_ativas', (select count(*) from public.automacoes where ativa),
    'enviados_30d', (select count(*) from public.envios
                     where sent_at > now() - interval '30 days'),
    'aberturas_30d', (select count(distinct lead_fk) from public.eventos_email
                      where tipo = 'open' and occurred_at > now() - interval '30 days'),
    'cliques_30d', (select count(distinct lead_fk) from public.eventos_email
                    where tipo = 'click' and occurred_at > now() - interval '30 days'),
    'novos_30d', (select count(*) from public.tabela_1_leads
                  where created_at > now() - interval '30 days'))
$$;

grant execute on function public.rel_crescimento(int) to authenticated;
grant execute on function public.rel_campanhas() to authenticated;
grant execute on function public.rel_tags() to authenticated;
grant execute on function public.rel_campo(text, int) to authenticated;
grant execute on function public.rel_engajamento() to authenticated;
grant execute on function public.rel_resumo() to authenticated;

commit;

select public.rel_resumo() as resumo;
