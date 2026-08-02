-- Pontuação v1.2 — tira o resíduo da importação do cálculo de recência.
--
-- A v1.1 punha 8.613 leads no topo. Número bom demais para ser verdade: a
-- base inteira teria entrado no último mês.
--
-- A causa: N vínculos de lista ficaram com a data da IMPORTAÇÃO
-- (hoje) porque o export do ActiveCampaign não trouxe a data real. O
-- cálculo lia isso como "entrou agora".
--
-- Fica de fora, então, a data de entrada em lista. Sobram a data de
-- criação do lead e a data das tags — as duas vieram reais do AC. Já
-- tínhamos verificado que TODO lead afetado tem data verdadeira por um
-- desses dois caminhos, então nada se perde.
begin;

create or replace function public.recalcular_pontuacao() returns int
language plpgsql security definer set search_path = public as $$
declare v_qtd int;
begin
  with regras as (select * from public.regras_pontuacao where ativa),
  soma as (
    select l.lead_id,
      coalesce(sum(
        case r.tipo
          when 'abriu_email' then
            case when exists (select 1 from public.eventos_email e
                              where e.lead_fk = l.lead_id and e.tipo = 'open'
                                and e.occurred_at > now() - (r.dias || ' days')::interval)
                 then r.pontos else 0 end
          when 'clicou_email' then
            case when exists (select 1 from public.eventos_email e
                              where e.lead_fk = l.lead_id and e.tipo = 'click'
                                and e.occurred_at > now() - (r.dias || ' days')::interval)
                 then r.pontos else 0 end
          when 'comprou' then
            case when exists (select 1 from public.tabela_4_alunos c where c.lead_fk = l.lead_id)
                 then r.pontos else 0 end
          when 'entrou_lista' then
            case when exists (select 1 from public.lead_listas ll
                              where ll.lead_fk = l.lead_id and ll.status = 1
                                and ll.subscribed_at > now() - (r.dias || ' days')::interval
                                and ll.subscribed_at::date <> current_date)
                 then r.pontos else 0 end
          when 'recencia' then
            case when greatest(
                   l.created_at,
                   coalesce((select max(lt.created_at) from public.lead_tags lt
                             where lt.lead_fk = l.lead_id), l.created_at)
                 ) > now() - (r.dias || ' days')::interval
                 then r.pontos else 0 end
          when 'tem_tag' then
            case when exists (select 1 from public.lead_tags lt
                              where lt.lead_fk = l.lead_id and lt.tag_fk = r.referencia)
                 then r.pontos else 0 end
          when 'descadastrou' then
            case when exists (select 1 from public.lead_listas ll
                              where ll.lead_fk = l.lead_id and ll.status = 2)
                 then r.pontos else 0 end
          when 'bounce' then
            case when exists (select 1 from public.supressao s
                              where s.email = l.email and s.motivo = 'hard_bounce')
                 then r.pontos else 0 end
          when 'reclamou' then
            case when exists (select 1 from public.supressao s
                              where s.email = l.email and s.motivo = 'complaint')
                 then r.pontos else 0 end
          when 'sem_atividade' then
            case when exists (select 1 from public.envios en
                              where en.lead_fk = l.lead_id and en.status in ('sent','delivered'))
                  and not exists (select 1 from public.eventos_email e
                                  where e.lead_fk = l.lead_id
                                    and e.occurred_at > now() - (r.dias || ' days')::interval)
                 then r.pontos else 0 end
          else 0
        end), 0) as pontos
    from public.tabela_1_leads l
    cross join regras r
    group by l.lead_id, l.created_at, l.email
  )
  insert into public.lead_pontuacao (lead_fk, pontos, calculado_em)
  select lead_id, pontos, now() from soma
  on conflict (lead_fk) do update
    set pontos = excluded.pontos, calculado_em = now();
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

commit;

select public.recalcular_pontuacao() as recalculados;

select case when pontos >= 40 then '1. topo (40+)'
            when pontos >= 20 then '2. quente (20-39)'
            when pontos >= 8  then '3. morno (8-19)'
            when pontos >= 1  then '4. frio (1-7)'
            else '5. zero ou negativo' end as faixa,
       count(*) as leads
from public.lead_pontuacao group by 1 order by 1;
