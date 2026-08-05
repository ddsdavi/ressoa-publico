-- =====================================================================
-- RECEITA EM REAIS SOMA SÓ VENDA EM REAIS
--
-- O histórico da Hotmart trouxe 59 vendas pagas em moeda estrangeira
-- (CLP, COP, MXN, EUR, GBP, CHF, USD, AUD). O valor fica registrado na
-- moeda em que a pessoa pagou — 68.304 pesos chilenos são "68304", e
-- somar isso com reais inflaria o faturamento em quase meio milhão que
-- não existe.
--
-- A regra: contagem de compras e compradores considera TODO MUNDO;
-- soma de dinheiro considera só o que foi pago em BRL. Converter moeda
-- na marra exigiria câmbio do dia de cada venda — impreciso e caro para
-- 0,6% das linhas.
-- =====================================================================
begin;

-- receita por dimensão de origem (origem_trafego, rede, midia, pagina_captura…)
create or replace function public.rel_atribuicao(p_campo text default 'origem_trafego')
returns table (valor text, compradores bigint, compras bigint,
               receita numeric, ticket numeric, leads bigint, conversao numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query execute format($f$
    with base as (
      select la.lead_fk,
             coalesce(nullif(la.dados ->> %L, ''), '(sem origem)') as valor
      from public.lead_atributos la
    ),
    vendas as (
      select b.valor,
             count(distinct c.lead_fk) as compradores,
             count(*) as compras,
             coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0) as receita,
             count(*) filter (where c.moeda = 'BRL') as compras_brl
      from base b
      join public.tabela_4_alunos c on c.lead_fk = b.lead_fk and c.status = 'aprovada'
      group by b.valor
    ),
    todos as (select valor, count(*) as leads from base group by valor)
    select t.valor,
           coalesce(v.compradores, 0),
           coalesce(v.compras, 0),
           coalesce(v.receita, 0)::numeric(12,2),
           (coalesce(v.receita, 0) / nullif(v.compras_brl, 0))::numeric(12,2),
           t.leads,
           (100.0 * coalesce(v.compradores, 0) / nullif(t.leads, 0))::numeric(6,2)
    from todos t
    left join vendas v on v.valor = t.valor
    order by 4 desc, 6 desc
  $f$, p_campo);
end $$;

-- os anúncios que mais trouxeram dinheiro
create or replace function public.rel_anuncios(p_limite int default 20)
returns table (anuncio text, rede text, pagina text,
               compradores bigint, receita numeric, primeira date, ultima date)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(la.dados ->> 'anuncio_id', ''), '(sem anúncio)'),
         max(la.dados ->> 'rede'),
         max(la.dados ->> 'pagina_captura'),
         count(distinct c.lead_fk),
         coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0)::numeric(12,2),
         min(c.data_compra)::date,
         max(c.data_compra)::date
  from public.lead_atributos la
  join public.tabela_4_alunos c on c.lead_fk = la.lead_fk and c.status = 'aprovada'
  group by 1
  order by 5 desc
  limit greatest(1, least(coalesce(p_limite, 20), 100))
$$;

-- o funil: de onde veio → quantos viraram comprador
create or replace function public.rel_funil_origem()
returns table (etapa text, ordem int, pessoas bigint, receita numeric)
language sql stable security definer set search_path = public as $$
  select 'Leads na base', 1, count(*)::bigint, 0::numeric from public.tabela_1_leads
  union all
  select 'Com origem identificada', 2, count(*)::bigint, 0::numeric
    from public.lead_atributos where dados ? 'origem_trafego'
  union all
  select 'Compraram', 3, count(distinct lead_fk)::bigint,
         coalesce(sum(valor) filter (where moeda = 'BRL'), 0)::numeric(12,2)
    from public.tabela_4_alunos where status = 'aprovada'
  union all
  select 'Compraram mais de uma vez', 4, count(*)::bigint, 0::numeric
    from (select lead_fk from public.tabela_4_alunos where status = 'aprovada'
          group by lead_fk having count(*) > 1) x
  order by 2
$$;

-- total gasto por pessoa: mesma regra. Quem pagou em peso chileno não
-- pode aparecer como quem gastou "68 mil" num filtro de total_gasto.
create or replace view public.compras_por_lead as
select c.lead_fk,
       count(*) filter (where c.status = 'aprovada') as compras,
       count(distinct c.nome_produto) filter (where c.status = 'aprovada') as produtos,
       coalesce(sum(c.valor) filter (where c.status = 'aprovada' and c.moeda = 'BRL'), 0) as total_gasto,
       count(*) filter (where c.status in ('reembolsada','chargeback')) as devolucoes,
       max(c.data_compra) filter (where c.status = 'aprovada') as ultima_compra,
       string_agg(distinct c.nome_produto, ' · ') filter (where c.status = 'aprovada') as lista_produtos
from public.tabela_4_alunos c
group by c.lead_fk;

grant execute on function public.rel_atribuicao(text) to authenticated;
grant execute on function public.rel_anuncios(int) to authenticated;
grant execute on function public.rel_funil_origem() to authenticated;
grant select on public.compras_por_lead to authenticated;

commit;

-- prova: a receita do funil tem que bater com a soma direta das vendas em BRL
select (select receita from public.rel_funil_origem() where ordem = 3) as receita_funil,
       (select round(sum(valor), 2) from public.tabela_4_alunos
         where status = 'aprovada' and moeda = 'BRL') as soma_direta_brl;
