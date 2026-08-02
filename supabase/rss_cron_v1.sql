-- =====================================================================
-- CRON DO RSS — de hora em hora, procura post novo.
--
-- O Postgres não lê XML de feed com jeito, então quem faz o trabalho é a
-- Edge Function; o cron só a acorda. A chamada é disparada e esquecida
-- (pg_net é assíncrono): se o blog estiver fora do ar, ninguém trava.
--
-- A chave de serviço fica no app_config, não aqui — este arquivo vai
-- para o GitHub.
-- =====================================================================
begin;

insert into public.app_config (chave, valor)
values ('service_key', '')
on conflict (chave) do nothing;

create or replace function public.rss_verificar() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.cfg('service_key');
  v_qtd  int;
begin
  select count(*) into v_qtd from public.rss_fontes where ativo;
  if v_qtd = 0 then
    return 'nenhuma fonte ativa';       -- não acorda ninguém à toa
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key na configuração';
  end if;

  perform net.http_post(
    url := v_base || '/rss',
    body := jsonb_build_object('verificar', true),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return v_qtd || ' fonte(s) enviada(s) para verificação';
end $$;

commit;

select cron.unschedule('rss-verificar')
where exists (select 1 from cron.job where jobname = 'rss-verificar');

select cron.schedule('rss-verificar', '7 * * * *', 'select public.rss_verificar()');

select public.rss_verificar() as estado_agora,
       (select schedule from cron.job where jobname = 'rss-verificar') as agendamento;
