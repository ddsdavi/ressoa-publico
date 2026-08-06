-- =====================================================================
-- TELEMETRIA v1 — o e-mail vendeu quanto?
--
-- Até aqui a plataforma media ABERTURA e CLIQUE. Nenhuma das duas paga
-- boleto. Esta migração cruza os envios com as compras aprovadas e
-- responde, por automação e por campanha: quantas pessoas receberam,
-- quantas compraram DEPOIS de receber, e quanto entrou em reais.
--
-- A regra de atribuição, e por que ela é honesta:
--
--   Conta a compra que aconteceu DEPOIS do e-mail sair (estritamente
--   depois de sent_at) e dentro de uma janela (14 dias por padrão).
--   Isso resolve sozinho o caso da janela quente, cujo GATILHO é uma
--   compra: a compra que disparou a sequência é anterior ao envio, então
--   nunca entra como resultado dele. Sem esse detalhe, a automação
--   pareceria converter 100% no primeiro dia.
--
--   A compra é contada uma única vez por (origem, pessoa, transação),
--   mesmo que a pessoa tenha recebido três e-mails da mesma automação.
--
-- Isto é atribuição de último toque por janela — não prova causalidade.
-- Serve para comparar automações entre si e para ver a régua evoluindo,
-- que é a decisão real do dia a dia.
-- =====================================================================
begin;

create or replace function public.rel_resultado_envios(p_dias int default 90, p_janela int default 14)
returns table (
  tipo text, nome text, ativa boolean, quando timestamptz,
  pessoas bigint, emails bigint, aberturas bigint, cliques bigint,
  compradores bigint, compras bigint, receita numeric, receita_por_email numeric)
language sql stable security definer set search_path to 'public' as $$
  with env as (
    select e.envio_id, e.lead_fk, e.sent_at,
           case when e.campanha_fk is not null then 'campanha' else 'automação' end as tipo,
           coalesce(c.nome, a.nome, '(avulso)') as nome,
           a.ativa
    from public.envios e
    left join public.campanhas c on c.campanha_id = e.campanha_fk
    left join public.automacoes a on a.automacao_id = e.automacao_fk
    where e.status in ('sent', 'delivered')
      and e.sent_at > now() - make_interval(days => greatest(1, p_dias))
  ),
  eventos as (
    select env.tipo, env.nome, ev.tipo as ev_tipo, ev.lead_fk
    from env join public.eventos_email ev on ev.envio_fk = env.envio_id
    where ev.tipo in ('open', 'click')
  ),
  -- a compra tem que ser POSTERIOR ao e-mail: é o que separa resultado de
  -- coincidência quando a própria compra é o gatilho da automação
  conv as (
    select distinct env.tipo, env.nome, env.lead_fk,
           cc.id_compra, cc.valor, cc.moeda
    from env
    join public.tabela_4_alunos cc
      on cc.lead_fk = env.lead_fk
     and cc.status = 'aprovada'
     and coalesce(cc.data_compra, cc.created_at) > env.sent_at
     and coalesce(cc.data_compra, cc.created_at) <= env.sent_at + make_interval(days => greatest(1, p_janela))
  ),
  base as (
    select tipo, nome, bool_or(ativa) as ativa, max(sent_at) as quando,
           count(distinct lead_fk) as pessoas, count(*) as emails
    from env group by 1, 2
  )
  select b.tipo, b.nome, b.ativa, b.quando, b.pessoas, b.emails,
         (select count(distinct e2.lead_fk) from eventos e2
          where e2.tipo = b.tipo and e2.nome = b.nome and e2.ev_tipo = 'open'),
         (select count(distinct e3.lead_fk) from eventos e3
          where e3.tipo = b.tipo and e3.nome = b.nome and e3.ev_tipo = 'click'),
         (select count(distinct c1.lead_fk) from conv c1 where c1.tipo = b.tipo and c1.nome = b.nome),
         (select count(distinct c2.id_compra) from conv c2 where c2.tipo = b.tipo and c2.nome = b.nome),
         coalesce((select sum(c3.valor) from conv c3
                   where c3.tipo = b.tipo and c3.nome = b.nome and c3.moeda = 'BRL'), 0)::numeric(12,2),
         (coalesce((select sum(c4.valor) from conv c4
                    where c4.tipo = b.tipo and c4.nome = b.nome and c4.moeda = 'BRL'), 0)
          / nullif(b.emails, 0))::numeric(12,2)
  from base b
  order by 11 desc, 6 desc
$$;

revoke execute on function public.rel_resultado_envios(int, int) from public, anon;
grant execute on function public.rel_resultado_envios(int, int) to authenticated, service_role;

comment on function public.rel_resultado_envios(int, int) is
  'Resultado de venda por automação/campanha. Só conta compra aprovada POSTERIOR ao envio, dentro da janela.';

commit;

select tipo, nome, pessoas, emails, compradores, receita
from public.rel_resultado_envios(90, 14);
