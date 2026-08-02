-- =====================================================================
-- ATRIBUIÇÃO — as consultas do painel.
--
-- A pergunta que isto responde não é "quantos cliques o anúncio teve",
-- que o Meta já mostra. É "quanto DINHEIRO cada anúncio trouxe" — e essa
-- o Meta não sabe responder, porque a venda acontece fora dele.
--
-- Toda conta usa só compra APROVADA: reembolso e chargeback entrando como
-- receita fariam um anúncio ruim parecer bom, que é o pior erro possível
-- num painel de atribuição — leva a colocar mais dinheiro no lugar errado.
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
             coalesce(sum(c.valor), 0) as receita
      from base b
      join public.tabela_4_alunos c on c.lead_fk = b.lead_fk and c.status = 'aprovada'
      group by b.valor
    ),
    todos as (select valor, count(*) as leads from base group by valor)
    select t.valor,
           coalesce(v.compradores, 0),
           coalesce(v.compras, 0),
           coalesce(v.receita, 0)::numeric(12,2),
           (coalesce(v.receita, 0) / nullif(v.compras, 0))::numeric(12,2),
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
         coalesce(sum(c.valor), 0)::numeric(12,2),
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
         coalesce(sum(valor), 0)::numeric(12,2)
    from public.tabela_4_alunos where status = 'aprovada'
  union all
  select 'Compraram mais de uma vez', 4, count(*)::bigint, 0::numeric
    from (select lead_fk from public.tabela_4_alunos where status = 'aprovada'
          group by lead_fk having count(*) > 1) x
  order by 2
$$;

grant execute on function public.rel_atribuicao(text) to authenticated;
grant execute on function public.rel_anuncios(int) to authenticated;
grant execute on function public.rel_funil_origem() to authenticated;

commit;

select valor, compradores, receita, leads, conversao
from public.rel_atribuicao('origem_trafego');
