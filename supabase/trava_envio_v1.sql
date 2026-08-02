-- =====================================================================
-- TRAVA DE ENVIO
--
-- Existe porque eu falhei. Rodei uma prova do teste A/B enfileirando dez
-- leads REAIS, anotando no comentário que "nenhum e-mail sai, porque
-- processar_fila_envios não é chamado aqui". Estava errado: o cron chama
-- processar_fila_envios de minuto em minuto. Quatro pessoas da base
-- receberam um e-mail cujo corpo era a letra "a" ou a letra "b".
--
-- A lição não é "tomar mais cuidado". É que um sistema que dispara de
-- minuto em minuto precisa de um freio que não dependa de ninguém
-- lembrar. Duas travas:
--
--   1. envio_pausado — botão de pânico. Ligado, nada sai da fila, venha
--      de onde vier. A fila continua enchendo; só não escoa.
--
--   2. envio_so_para — enquanto tiver conteúdo, só saem e-mails para os
--      endereços dessa lista (separados por vírgula). É o modo de teste
--      que faltava: dá para exercitar campanha, automação e A/B de ponta
--      a ponta, com o provedor de verdade, sem alcançar a base.
--
-- Quem fica de fora do filtro não é enviado depois às escondidas: é
-- marcado como 'retido', para dar para ver exatamente o que teria saído.
--
-- O corpo da função de envio não é reescrito aqui. Ele é renomeado e
-- embrulhado — reescrever cento e poucas linhas de lógica de provedor
-- para acrescentar dois ifs é como se introduz o terceiro erro.
-- =====================================================================
begin;

insert into public.app_config (chave, valor) values
  ('envio_pausado', 'false'),
  ('envio_so_para', '')
on conflict (chave) do nothing;

do $$
begin
  -- só renomeia uma vez; rodar o arquivo de novo não empilha camadas
  if not exists (select 1 from pg_proc where proname = 'processar_fila_envios_interno') then
    alter function public.processar_fila_envios() rename to processar_fila_envios_interno;
  end if;
end $$;

create or replace function public.processar_fila_envios() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_pausado boolean := coalesce(public.cfg('envio_pausado'), 'false') = 'true';
  v_filtro  text    := coalesce(public.cfg('envio_so_para'), '');
  v_lista   text[];
  v_retidos int := 0;
begin
  if v_pausado then
    return 0;
  end if;

  if btrim(v_filtro) <> '' then
    select array_agg(lower(btrim(x))) into v_lista
    from unnest(string_to_array(v_filtro, ',')) x
    where btrim(x) <> '';

    update public.envios e
    set status = 'retido'
    from public.tabela_1_leads l
    where e.lead_fk = l.lead_id
      and e.status = 'queued'
      and not (lower(l.email::text) = any(v_lista));
    get diagnostics v_retidos = row_count;
  end if;

  return public.processar_fila_envios_interno();
end $$;

commit;

select public.cfg('envio_pausado')                                    as pausado,
       coalesce(nullif(public.cfg('envio_so_para'), ''), '(todos)')    as so_para,
       (select count(*) from public.envios where status = 'queued')    as na_fila,
       (select count(*) from pg_proc
        where proname = 'processar_fila_envios_interno')               as interna_existe;

-- 'retido' precisa ser um status válido, senão a própria trava derruba a
-- transação. Descoberto testando: a prova falhou aqui antes de falhar em
-- qualquer outro lugar — que é exatamente onde uma trava deve falhar.
alter table public.envios drop constraint if exists envios_status_check;
alter table public.envios add constraint envios_status_check
  check (status in ('queued','sent','delivered','bounced','complained',
                    'failed','suppressed','retido','cancelled'));

select pg_get_constraintdef(oid) as restricao_final
from pg_constraint where conname = 'envios_status_check';
