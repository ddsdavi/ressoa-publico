-- =====================================================================
-- FICHA DO LEAD v2 — o que faltava para a ficha ficar melhor que a do AC:
--
--   1. LINHA DO TEMPO. Os dados já existiam, espalhados em sete tabelas.
--      Aqui viram uma história em ordem cronológica: entrou na lista,
--      ganhou tag, participou do evento, recebeu, abriu, clicou, entrou na
--      automação, COMPROU. A compra é o que o AC não tem — lá "conversão"
--      é um número solto; aqui é o produto, o valor e a forma de pagamento.
--
--   2. NOTAS. Anotação humana sobre a pessoa, que fica registrada com
--      autor e data.
-- =====================================================================
begin;

-- ---------- notas ----------
create table if not exists public.lead_notas (
  nota_id     uuid primary key default gen_random_uuid(),
  lead_fk     uuid not null references public.tabela_1_leads(lead_id) on delete cascade,
  autor_email text,
  texto       text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ix_lead_notas_lead on public.lead_notas (lead_fk, created_at desc);

alter table public.lead_notas enable row level security;

drop policy if exists notas_leitura on public.lead_notas;
create policy notas_leitura on public.lead_notas
  for select to authenticated using (public.papel_atual() is not null);

-- assistente também anota: registrar informação é preparação, não disparo
drop policy if exists notas_escrita on public.lead_notas;
create policy notas_escrita on public.lead_notas
  for insert to authenticated
  with check (public.papel_atual() in ('admin', 'terapeuta', 'assistente'));

-- apagar: só quem escreveu, ou um admin
drop policy if exists notas_remocao on public.lead_notas;
create policy notas_remocao on public.lead_notas
  for delete to authenticated
  using (public.papel_atual() = 'admin' or autor_email = auth.jwt() ->> 'email');

grant select, insert, delete on public.lead_notas to authenticated;

-- ---------- linha do tempo ----------
create or replace function public.linha_do_tempo(p_lead uuid, p_limite int default 120)
returns table (quando timestamptz, tipo text, titulo text, detalhe text)
language sql stable security definer set search_path = public as $$
  with tudo as (
    -- entrou / saiu de lista
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

    -- a compra: o que o AC não mostra com esse detalhe
    union all
    select c.created_at, 'compra', 'Comprou',
           coalesce(c.nome_produto, c.evento_origem, 'produto') ||
           coalesce(' — ' || coalesce(c.moeda, 'R$') || ' ' || c.valor::text, '') ||
           coalesce(' (' || c.forma_de_pagamento || ')', '')
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

commit;

-- prova: a linha do tempo de um lead que comprou
select tipo, titulo, left(coalesce(detalhe,''), 40) as detalhe
from public.linha_do_tempo((select lead_fk from public.tabela_4_alunos limit 1), 8);
