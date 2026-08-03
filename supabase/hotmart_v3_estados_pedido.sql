-- Hotmart v3: pedido nao e sinonimo de venda.
-- Mantem todos os estados para auditoria e recuperacao, mas somente um
-- pedido aprovado pode ser exibido ou disparado como compra realizada.

begin;

alter table public.tabela_4_alunos
  add column if not exists updated_at timestamptz not null default now();

-- O historico cru e a fonte de verdade do ultimo evento recebido.
with ultimos as (
  select distinct on (h.transacao)
         h.transacao, h.evento, h.recebido_em
  from public.hotmart_eventos h
  where h.transacao is not null
  order by h.transacao, h.recebido_em desc
)
update public.tabela_4_alunos c
set evento_origem = u.evento,
    updated_at = u.recebido_em
from ultimos u
where c.codigo_transacao = u.transacao;

comment on table public.tabela_4_alunos is
  'Pedidos registrados por checkout. Somente status aprovada representa comprador.';

create or replace function public.trg_evento_compra() returns trigger
language plpgsql as $$
declare
  v_tipo text;
begin
  -- Nao repete evento se um webhook reenviado mantiver o mesmo estado.
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  v_tipo := case new.status
    when 'aprovada' then 'compra_realizada'
    when 'reembolsada' then 'compra_reembolsada'
    when 'parcialmente_reembolsada' then 'compra_reembolso_parcial'
    when 'chargeback' then 'compra_chargeback'
    when 'cancelada' then 'compra_cancelada'
    else null
  end;

  -- Pendente e expirada sao intencoes, tratadas pelo registrar_intencao.
  if v_tipo is not null then
    insert into public.eventos_sistema (tipo, lead_fk, payload)
    values (
      v_tipo,
      new.lead_fk,
      jsonb_build_object(
        'produto', new.nome_produto,
        'valor', new.valor,
        'status', new.status,
        'evento', new.evento_origem,
        'transacao', new.codigo_transacao
      )
    );
  end if;

  return new;
end $$;

drop trigger if exists trg_evento_compra on public.tabela_4_alunos;
create trigger trg_evento_compra
after insert or update of status on public.tabela_4_alunos
for each row execute function public.trg_evento_compra();

create or replace function public.avaliar_condicao(p_lead uuid, p_cond jsonb)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_tipo text := p_cond->>'tipo';
  v_dias int := coalesce((p_cond->>'dias')::int, 30);
begin
  if v_tipo = 'tem_tag' then
    return exists (select 1 from public.lead_tags
                   where lead_fk = p_lead and tag_fk = (p_cond->>'tag_id')::int);

  elsif v_tipo = 'na_lista' then
    return exists (select 1 from public.lead_listas
                   where lead_fk = p_lead and lista_fk = (p_cond->>'lista_id')::int
                     and status = coalesce((p_cond->>'status')::int, 1));

  elsif v_tipo = 'abriu_email' then
    return exists (select 1 from public.eventos_email
                   where lead_fk = p_lead and tipo = 'open'
                     and occurred_at > now() - (v_dias || ' days')::interval);

  elsif v_tipo = 'clicou_email' then
    return exists (select 1 from public.eventos_email
                   where lead_fk = p_lead and tipo = 'click'
                     and occurred_at > now() - (v_dias || ' days')::interval);

  elsif v_tipo = 'comprou' then
    return exists (select 1 from public.tabela_4_alunos
                   where lead_fk = p_lead
                     and status = 'aprovada'
                     and (p_cond->>'produto' is null
                          or nome_produto ilike '%' || (p_cond->>'produto') || '%'));

  elsif v_tipo = 'tem_whatsapp' then
    return exists (select 1 from public.tabela_1_leads
                   where lead_id = p_lead and coalesce(whatsapp, '') <> '');

  elsif v_tipo = 'campo_igual' then
    return exists (select 1 from public.lead_atributos
                   where lead_fk = p_lead
                     and dados ->> (p_cond->>'chave') = (p_cond->>'valor'));

  elsif v_tipo = 'nao_suprimido' then
    return not exists (select 1 from public.supressao s
                       join public.tabela_1_leads l on l.email = s.email
                       where l.lead_id = p_lead);
  end if;

  return true;
end $$;

grant execute on function public.avaliar_condicao(uuid, jsonb) to authenticated;

create or replace function public.linha_do_tempo(p_lead uuid, p_limite int default 120)
returns table (quando timestamptz, tipo text, titulo text, detalhe text)
language sql stable security definer set search_path = public as $$
  with tudo as (
    select ll.subscribed_at, 'lista'::text,
           case ll.status when 2 then 'Descadastrou-se da lista'
                          when 3 then 'Deu erro de entrega na lista'
                          else 'Entrou na lista' end,
           l.nome
    from public.lead_listas ll
    join public.listas l on l.lista_id = ll.lista_fk
    where ll.lead_fk = p_lead

    union all
    select lt.created_at, 'tag', 'Recebeu a tag', t.nome
    from public.lead_tags lt
    join public.tags t on t.tag_id = lt.tag_fk
    where lt.lead_fk = p_lead

    union all
    select p.created_at, 'evento', 'Participou do evento', p.evento_origem
    from public.tabela_2_participacoes p
    where p.lead_fk = p_lead

    union all
    select case when c.status = 'aprovada'
                then coalesce(c.data_compra, c.updated_at, c.created_at)
                else coalesce(c.updated_at, c.created_at, c.data_compra) end,
           'compra',
           case
             when c.status = 'aprovada' then 'Comprou'
             when c.status = 'pendente' and c.evento_origem = 'PURCHASE_BILLET_PRINTED' then 'Boleto emitido'
             when c.status = 'pendente' and c.evento_origem = 'PURCHASE_DELAYED' then 'Pagamento atrasado'
             when c.status = 'pendente' then 'Pagamento pendente'
             when c.status = 'expirada' then 'Pagamento expirou'
             when c.status = 'cancelada' then 'Pedido cancelado'
             when c.status = 'reembolsada' then 'Compra reembolsada'
             when c.status = 'parcialmente_reembolsada' then 'Compra parcialmente reembolsada'
             when c.status = 'chargeback' and c.evento_origem = 'PURCHASE_PROTEST' then 'Compra protestada'
             when c.status = 'chargeback' then 'Chargeback da compra'
             else 'Pedido Hotmart'
           end,
           coalesce(c.nome_produto, c.evento_origem, 'produto') ||
           coalesce(' — ' || coalesce(c.moeda, 'R$') || ' ' || c.valor::text, '') ||
           coalesce(' (' || c.forma_de_pagamento || ')', '') ||
           case when c.status = 'aprovada' then '' else ' — status: ' || coalesce(c.status, 'desconhecido') end
    from public.tabela_4_alunos c
    where c.lead_fk = p_lead

    union all
    select e.sent_at, 'envio', 'Recebeu o e-mail', m.subject
    from public.envios e
    left join public.mensagens m on m.mensagem_id = e.mensagem_fk
    where e.lead_fk = p_lead and e.sent_at is not null

    union all
    select ev.occurred_at, ev.tipo,
           case ev.tipo when 'open' then 'Abriu o e-mail'
                        when 'click' then 'Clicou em um link'
                        when 'delivered' then 'E-mail entregue'
                        when 'bounce_hard' then 'E-mail voltou (endereço morto)'
                        when 'complaint' then 'Marcou como spam'
                        else ev.tipo end,
           coalesce(ev.url, m.subject)
    from public.eventos_email ev
    left join public.envios e on e.envio_id = ev.envio_fk
    left join public.mensagens m on m.mensagem_id = e.mensagem_fk
    where ev.lead_fk = p_lead and ev.tipo <> 'sent'

    union all
    select ax.iniciado_em, 'automacao', 'Entrou na automação', a.nome
    from public.automacao_execucoes ax
    join public.automacoes a on a.automacao_id = ax.automacao_fk
    where ax.lead_fk = p_lead and ax.iniciado_em is not null

    union all
    select ax.finalizado_em, 'automacao', 'Concluiu a automação', a.nome
    from public.automacao_execucoes ax
    join public.automacoes a on a.automacao_id = ax.automacao_fk
    where ax.lead_fk = p_lead and ax.finalizado_em is not null

    union all
    select s.created_at, 'bloqueio', 'Bloqueado para envio', s.motivo
    from public.supressao s
    join public.tabela_1_leads l on l.email = s.email
    where l.lead_id = p_lead

    union all
    select n.created_at, 'nota', 'Anotação de ' || coalesce(n.autor_email, 'alguém do time'), n.texto
    from public.lead_notas n
    where n.lead_fk = p_lead
  )
  select * from tudo
  where subscribed_at is not null
  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 120), 500))
$$;

grant execute on function public.linha_do_tempo(uuid, int) to authenticated;

-- Remove somente o evento derivado que e comprovadamente falso: pedido nao
-- aprovado e sem nenhum APPROVED/COMPLETE anterior para a mesma transacao.
-- O historico cru e os pedidos permanecem intactos.
delete from public.eventos_sistema e
using public.tabela_4_alunos c
where e.tipo = 'compra_realizada'
  and e.payload->>'transacao' = c.codigo_transacao
  and c.status in ('pendente', 'expirada', 'cancelada')
  and not exists (
    select 1
    from public.hotmart_eventos h
    where h.transacao = c.codigo_transacao
      and (
        h.evento in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETE')
        or h.corpo->'data'->'purchase'->>'status' in ('APPROVED', 'COMPLETE')
      )
  );

commit;

-- Provas mecanicas da regra aplicada.
select
  position('status = ''aprovada''' in pg_get_functiondef('public.avaliar_condicao(uuid,jsonb)'::regprocedure)) > 0
    as condicao_comprou_exige_aprovada,
  position('compra_realizada' in pg_get_functiondef('public.trg_evento_compra()'::regprocedure)) > 0
    as trigger_classifica_estado;
