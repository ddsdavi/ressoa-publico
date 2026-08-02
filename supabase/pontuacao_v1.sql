-- =====================================================================
-- PONTUAÇÃO DE LEADS
--
-- Cada coisa que a pessoa faz vale pontos. Quem abre e clica sobe; quem
-- some cai. Serve para saber por quem começar o aquecimento, quem chamar
-- no lançamento e quem está esfriando.
--
-- Duas decisões que mudam o resultado:
--
--   1. A pontuação é RECALCULADA, não acumulada em contador. Contador
--      acumulado erra quando um evento chega duas vezes, quando a regra
--      muda de valor ou quando alguém apaga uma tag. Recalcular a partir
--      dos fatos sempre dá o número certo.
--
--   2. Tem DECAIMENTO por tempo. Sem isso, quem foi muito ativo há dois
--      anos e sumiu continuaria no topo para sempre — exatamente quem
--      NÃO se deve priorizar num domínio novo.
-- =====================================================================
begin;

create table if not exists public.regras_pontuacao (
  regra_id   int generated always as identity primary key,
  nome       text not null,
  tipo       text not null check (tipo in
             ('abriu_email','clicou_email','comprou','entrou_lista','tem_tag',
              'bounce','reclamou','descadastrou','sem_atividade')),
  pontos     int not null,
  dias       int,              -- janela de tempo, quando faz sentido
  referencia int,              -- tag_id ou lista_id, quando o tipo pede
  ativa      boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.regras_pontuacao enable row level security;
drop policy if exists regras_le on public.regras_pontuacao;
create policy regras_le on public.regras_pontuacao
  for select to authenticated using (public.papel_atual() is not null);
drop policy if exists regras_escreve on public.regras_pontuacao;
create policy regras_escreve on public.regras_pontuacao
  for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');
grant select, insert, update, delete on public.regras_pontuacao to authenticated;

create table if not exists public.lead_pontuacao (
  lead_fk      uuid primary key references public.tabela_1_leads(lead_id) on delete cascade,
  pontos       int not null default 0,
  calculado_em timestamptz not null default now()
);
create index if not exists ix_pontuacao_desc on public.lead_pontuacao (pontos desc);

alter table public.lead_pontuacao enable row level security;
drop policy if exists pont_le on public.lead_pontuacao;
create policy pont_le on public.lead_pontuacao
  for select to authenticated using (public.papel_atual() is not null);
grant select on public.lead_pontuacao to authenticated;

-- regras iniciais, pensadas para o momento de aquecimento de domínio
insert into public.regras_pontuacao (nome, tipo, pontos, dias)
select * from (values
  ('Abriu um e-mail nos últimos 30 dias',  'abriu_email',   5,  30),
  ('Abriu um e-mail nos últimos 90 dias',  'abriu_email',   2,  90),
  ('Clicou num link nos últimos 30 dias',  'clicou_email', 15,  30),
  ('Clicou num link nos últimos 90 dias',  'clicou_email',  6,  90),
  ('Já comprou alguma vez',                'comprou',      40,  null),
  ('Entrou em alguma lista nos últimos 30 dias', 'entrou_lista', 8, 30),
  ('Sem nenhuma atividade há mais de 180 dias', 'sem_atividade', -20, 180),
  ('Descadastrou-se de alguma lista',      'descadastrou', -30, null),
  ('Deu erro de entrega',                  'bounce',      -50, null),
  ('Marcou como spam',                     'reclamou',   -100, null)
) v
where not exists (select 1 from public.regras_pontuacao);

-- ------------------------------------------------------------------
-- Recalcula tudo. Roda inteiro (12 mil leads) em segundos porque é uma
-- consulta só, não um laço por pessoa.
-- ------------------------------------------------------------------
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
            case when not exists (select 1 from public.eventos_email e
                                  where e.lead_fk = l.lead_id
                                    and e.occurred_at > now() - (r.dias || ' days')::interval)
                 then r.pontos else 0 end
          else 0
        end), 0) as pontos
    from public.tabela_1_leads l
    cross join regras r
    group by l.lead_id
  )
  insert into public.lead_pontuacao (lead_fk, pontos, calculado_em)
  select lead_id, pontos, now() from soma
  on conflict (lead_fk) do update
    set pontos = excluded.pontos, calculado_em = now();
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

grant execute on function public.recalcular_pontuacao() to authenticated;

-- recalcula toda madrugada; durante o dia o número de ontem serve
select cron.schedule('pontuacao-diaria', '32 3 * * *',
                     'select public.recalcular_pontuacao()')
where not exists (select 1 from cron.job where jobname = 'pontuacao-diaria');

commit;

select public.recalcular_pontuacao() as leads_pontuados;

select 'topo' as faixa, count(*) as leads from public.lead_pontuacao where pontos >= 40
union all select 'medio', count(*) from public.lead_pontuacao where pontos between 10 and 39
union all select 'baixo', count(*) from public.lead_pontuacao where pontos between 1 and 9
union all select 'zero ou negativo', count(*) from public.lead_pontuacao where pontos <= 0;
