-- =====================================================================
-- GATILHO POR DATA DO CONTATO
--
-- "Envia no aniversário do contato, entre outras datas." Funciona em cima
-- de qualquer campo do tipo data: aniversário, data da compra, data da
-- consulta. Uma vez por dia o sistema olha quem faz a data hoje (ou daqui
-- a N dias) e dispara.
--
-- Duas decisões:
--
--   1. Compara DIA e MÊS, não a data inteira. Aniversário se repete todo
--      ano; comparar a data completa faria disparar uma vez só, no ano em
--      que a pessoa nasceu — ou seja, nunca.
--
--   2. Guarda o ano do último disparo por lead e por automação. Sem isso,
--      um reprocessamento no mesmo dia mandaria o "feliz aniversário" duas
--      vezes, e o segundo é pior que nenhum.
-- =====================================================================
begin;

create table if not exists public.data_disparos (
  automacao_fk uuid not null references public.automacoes(automacao_id) on delete cascade,
  lead_fk      uuid not null,
  ano          int  not null,
  disparado_em timestamptz not null default now(),
  primary key (automacao_fk, lead_fk, ano)
);
alter table public.data_disparos enable row level security;
revoke all on public.data_disparos from anon, authenticated;

-- ------------------------------------------------------------------
-- varredura diária
-- ------------------------------------------------------------------
-- gatilho esperado:
--   {"tipo":"data_do_contato", "campo":"aniversario", "dias_antes":0}
create or replace function public.verificar_datas() returns int
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_campo text;
  v_antes int;
  v_alvo date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ano int := extract(year from v_hoje)::int;
  v_qtd int := 0;
  v_n int;
begin
  for a in
    select automacao_id, gatilho from public.automacoes
    where ativa and gatilho->>'tipo' = 'data_do_contato'
  loop
    v_campo := a.gatilho->>'campo';
    if coalesce(v_campo, '') = '' then continue; end if;
    v_antes := coalesce((a.gatilho->>'dias_antes')::int, 0);
    v_alvo  := v_hoje + v_antes;      -- avisar N dias antes = olhar N dias à frente

    with candidatos as (
      select la.lead_fk, (la.dados ->> v_campo) as valor
      from public.lead_atributos la
      where la.dados ? v_campo and coalesce(la.dados ->> v_campo, '') <> ''
    ),
    -- data mal escrita não derruba a varredura inteira: quem não converte
    -- fica de fora e os outros seguem
    validos as (
      select lead_fk, valor,
             case when valor ~ '^\d{4}-\d{2}-\d{2}' then substring(valor, 1, 10)::date
                  when valor ~ '^\d{2}/\d{2}/\d{4}$' then to_date(valor, 'DD/MM/YYYY')
                  else null end as d
      from candidatos
    ),
    novos as (
      insert into public.eventos_sistema (tipo, lead_fk, payload)
      select 'data_do_contato', v.lead_fk,
             jsonb_build_object('campo', v_campo, 'data', v.d,
                                'dias_antes', v_antes,
                                'automacao', a.automacao_id)
      from validos v
      where v.d is not null
        and extract(month from v.d) = extract(month from v_alvo)
        and extract(day   from v.d) = extract(day   from v_alvo)
        and not exists (select 1 from public.data_disparos dd
                        where dd.automacao_fk = a.automacao_id
                          and dd.lead_fk = v.lead_fk and dd.ano = v_ano)
      returning lead_fk
    )
    insert into public.data_disparos (automacao_fk, lead_fk, ano)
    select a.automacao_id, lead_fk, v_ano from novos
    on conflict do nothing;

    get diagnostics v_n = row_count;
    v_qtd := v_qtd + v_n;
  end loop;
  return v_qtd;
end $$;

-- o evento precisa casar com a automação certa, não com todas as de data
create or replace function public.processar_eventos_sistema() returns int
language plpgsql security definer as $$
declare
  v_evento record;
  v_auto record;
  v_hook record;
  v_qtd int := 0;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_evento in
    select * from public.eventos_sistema
    where processado_em is null
    order by evento_id
    limit 200
    for update skip locked
  loop
    for v_auto in
      select a.automacao_id from public.automacoes a
      where a.ativa
        and a.gatilho is not null
        and a.gatilho->>'tipo' = v_evento.tipo
        and (
          (v_evento.tipo in ('lista_inscrita', 'lista_descadastrada') and (
             coalesce((a.gatilho->>'qualquer_lista')::boolean, false)
             or a.gatilho->>'lista_id' is null
             or (a.gatilho->>'lista_id')::int = (v_evento.payload->>'lista_id')::int))
          or
          (v_evento.tipo = 'tag_adicionada' and
             (a.gatilho->>'tag_id')::int = (v_evento.payload->>'tag_id')::int)
          or
          (v_evento.tipo in ('email_aberto', 'email_clicado') and (
             a.gatilho->>'campanha_id' is null
             or a.gatilho->>'campanha_id' = v_evento.payload->>'campanha_id'))
          or
          (v_evento.tipo in ('compra_realizada', 'carrinho_abandonado', 'boleto_gerado',
                             'pagamento_atrasado', 'pagamento_expirou') and (
             a.gatilho->>'produto' is null
             or v_evento.payload->>'produto' ilike '%' || (a.gatilho->>'produto') || '%'))
          or
          (v_evento.tipo = 'rss_novo_item' and (
             a.gatilho->>'fonte_id' is null
             or (a.gatilho->>'fonte_id')::int = (v_evento.payload->>'fonte_id')::int))
          or
          -- o evento de data já nasce endereçado à automação que o gerou
          (v_evento.tipo = 'data_do_contato'
             and a.automacao_id::text = v_evento.payload->>'automacao')
          or
          (v_evento.tipo not in ('lista_inscrita', 'lista_descadastrada', 'tag_adicionada',
                                 'email_aberto', 'email_clicado', 'compra_realizada',
                                 'carrinho_abandonado', 'boleto_gerado',
                                 'pagamento_atrasado', 'pagamento_expirou',
                                 'rss_novo_item', 'data_do_contato'))
        )
    loop
      if not exists (select 1 from public.automacao_execucoes e
                     where e.automacao_fk = v_auto.automacao_id
                       and e.lead_fk = v_evento.lead_fk
                       and e.status in ('em_andamento', 'aguardando', 'ativa')) then
        insert into public.automacao_execucoes
          (automacao_fk, lead_fk, passo_atual, agendado_para, contexto)
        values (v_auto.automacao_id, v_evento.lead_fk, 1, now(), v_evento.payload);
      end if;
    end loop;

    if v_webhooks then
      for v_hook in
        select * from public.webhooks_saida w where w.ativo and v_evento.tipo = any(w.eventos)
      loop
        perform net.http_post(
          url := v_hook.url,
          body := jsonb_build_object(
            'evento', v_evento.tipo, 'payload', v_evento.payload,
            'contato', case when v_evento.lead_fk is not null
                            then public.payload_contato(v_evento.lead_fk) end,
            'ocorrido_em', v_evento.created_at),
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'X-Webhook-Secret', coalesce(v_hook.secret, '')));
      end loop;
    end if;

    update public.eventos_sistema set processado_em = now() where evento_id = v_evento.evento_id;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- a lista de campanhas precisa saber o tipo para oferecer o placar A/B
drop view if exists public.campanha_stats cascade;
create view public.campanha_stats as
select c.campanha_id, c.nome, c.status, c.tipo, c.vencedor, c.created_at,
       count(e.envio_id) filter (where e.status <> 'suppressed')            as enviados,
       count(e.envio_id) filter (where e.status = 'suppressed')             as suprimidos,
       count(distinct e.lead_fk) filter (where ev.tipo = 'open')            as aberturas_unicas,
       count(distinct e.lead_fk) filter (where ev.tipo = 'click')           as cliques_unicos,
       count(distinct e.lead_fk) filter (where ev.tipo = 'bounce_hard')     as hard_bounces,
       count(distinct e.lead_fk) filter (where ev.tipo = 'unsubscribe')     as descadastros
from public.campanhas c
left join public.envios e on e.campanha_fk = c.campanha_id
left join public.eventos_email ev on ev.envio_fk = e.envio_id
group by c.campanha_id, c.nome, c.status, c.tipo, c.vencedor, c.created_at;

grant select on public.campanha_stats to authenticated;
grant execute on function public.verificar_datas() to authenticated;

commit;

select cron.unschedule('verificar-datas')
where exists (select 1 from cron.job where jobname = 'verificar-datas');

-- 06:13 de Brasília (09:13 UTC): cedo o bastante para o e-mail de
-- aniversário chegar antes do dia começar de verdade
select cron.schedule('verificar-datas', '13 9 * * *', 'select public.verificar_datas()');

select public.verificar_datas() as disparos_hoje,
       (select schedule from cron.job where jobname = 'verificar-datas') as agendamento,
       (select count(*) from public.campanha_stats) as campanhas_na_view;
