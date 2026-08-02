-- Pontuação v1.1 — faz o número servir ANTES da primeira campanha.
--
-- Na v1 todo mundo caía em -20: a regra de inatividade olha histórico de
-- e-mail, e não existe histórico nenhum ainda. O número ficava igual para
-- os N e não ordenava nada — inútil justamente no momento em que
-- mais preciso dele, que é escolher por quem começar o aquecimento.
--
-- Correção: enquanto não há histórico de e-mail, o que separa as pessoas é
-- HÁ QUANTO TEMPO ELAS ENTRARAM. Quem se cadastrou mês passado lembra da
-- a dona da conta; quem entrou há um ano, não. Essa é a ordem certa para aquecer.
--
-- E a regra de inatividade passa a só valer para quem JÁ RECEBEU e-mail —
-- punir por não abrir um e-mail que nunca foi enviado não faz sentido.
begin;

update public.regras_pontuacao set ativa = false where tipo = 'sem_atividade';

alter table public.regras_pontuacao drop constraint if exists regras_pontuacao_tipo_check;
alter table public.regras_pontuacao add constraint regras_pontuacao_tipo_check
  check (tipo in ('abriu_email','clicou_email','comprou','entrou_lista','tem_tag',
                  'bounce','reclamou','descadastrou','sem_atividade','recencia'));

insert into public.regras_pontuacao (nome, tipo, pontos, dias) values
  ('Entrou na base nos últimos 30 dias',  'recencia', 25, 30),
  ('Entrou na base nos últimos 90 dias',  'recencia', 15, 90),
  ('Entrou na base nos últimos 180 dias', 'recencia',  8, 180),
  ('Entrou na base nos últimos 365 dias', 'recencia',  3, 365),
  ('Recebeu e-mail e não abriu em 180 dias', 'sem_atividade', -20, 180);

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
                                and ll.subscribed_at > now() - (r.dias || ' days')::interval)
                 then r.pontos else 0 end
          -- a mais recente entre entrar na base, entrar em lista e ganhar tag
          when 'recencia' then
            case when greatest(
                   l.created_at,
                   coalesce((select max(ll.subscribed_at) from public.lead_listas ll where ll.lead_fk = l.lead_id), l.created_at),
                   coalesce((select max(lt.created_at) from public.lead_tags lt where lt.lead_fk = l.lead_id), l.created_at)
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
          -- só pune quem realmente recebeu algo e não abriu
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
