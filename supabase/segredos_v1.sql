-- =====================================================================
-- COFRE DE SEGREDOS
--
-- A chave de serviço tinha ido parar no app_config, e o app_config é lido
-- inteiro pela tela de Configurações — ou seja, a chave que ignora todo o
-- RLS estaria trafegando para o navegador de quem é admin. Um admin não é
-- um invasor, mas o navegador dele é a parte mais exposta do sistema: uma
-- extensão curiosa e o banco inteiro vai junto.
--
-- Aqui os segredos ficam numa tabela sem NENHUMA política e sem permissão
-- para authenticated nem anon. Ninguém lê pelo PostgREST. Só as funções
-- security definer, que rodam como dono, conseguem chegar até eles.
-- =====================================================================
begin;

create table if not exists public.segredos (
  chave      text primary key,
  valor      text not null,
  updated_at timestamptz not null default now()
);

alter table public.segredos enable row level security;
-- de propósito: nenhuma policy. RLS ligado e sem policy = ninguém passa.
revoke all on public.segredos from anon, authenticated, public;

create or replace function public.segredo(p_chave text) returns text
language sql security definer stable set search_path = public as $$
  select valor from public.segredos where chave = p_chave;
$$;
revoke all on function public.segredo(text) from anon, authenticated, public;

-- muda a origem da chave usada pelo cron do RSS
create or replace function public.rss_verificar() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
  v_qtd  int;
begin
  select count(*) into v_qtd from public.rss_fontes where ativo;
  if v_qtd = 0 then
    return 'nenhuma fonte ativa';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking na configuração ou service_key no cofre';
  end if;

  perform net.http_post(
    url := v_base || '/rss',
    body := jsonb_build_object('verificar', true),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return v_qtd || ' fonte(s) enviada(s) para verificação';
end $$;

-- muda de lugar o que já estava gravado e apaga a cópia exposta
insert into public.segredos (chave, valor)
select 'service_key', valor from public.app_config
where chave = 'service_key' and coalesce(valor, '') <> ''
on conflict (chave) do update set valor = excluded.valor, updated_at = now();

delete from public.app_config where chave = 'service_key';

commit;

select
  (select count(*) from public.app_config where chave = 'service_key')  as sobrou_no_app_config,
  (select length(valor) from public.segredos where chave = 'service_key') as tamanho_no_cofre,
  public.rss_verificar() as cron_ainda_funciona;
