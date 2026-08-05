-- =====================================================================
-- GOOGLE PLANILHAS NATIVO — sem n8n no caminho.
--
-- A conta Google é conectada uma vez em Configurações (OAuth; tokens em
-- public.segredos, invisíveis para o painel). O passo "Planilha do Google"
-- das automações ganha um modo novo: em vez de uma URL de n8n, ele guarda
-- planilha + aba + o mapeamento coluna ↔ campo, e quem escreve a linha é a
-- Edge Function google-sheets.
--
-- O modo antigo (config com "url") continua funcionando exatamente como
-- era — um POST genérico, atrás da chave-geral executar_webhooks. O modo
-- novo NÃO passa por essa chave: é integração de primeira, como o ManyChat.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. a tela pode guardar as credenciais do app OAuth do Google
-- ------------------------------------------------------------------
create or replace function public.guardar_segredo(p_chave text, p_valor text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if public.papel_atual() is distinct from 'admin' then
    raise exception 'só admin muda segredo';
  end if;
  -- lista fechada: assim ninguém usa esta função para gravar qualquer coisa.
  -- Os tokens do Google (refresh/access) NÃO estão aqui de propósito: quem
  -- os grava é a própria Edge Function, com a service key.
  if p_chave not in ('manychat_api_key', 'service_key',
                     'google_client_id', 'google_client_secret') then
    raise exception 'segredo desconhecido: %', p_chave;
  end if;

  if coalesce(btrim(p_valor), '') = '' then
    delete from public.segredos where chave = p_chave;
    return 'removido';
  end if;

  insert into public.segredos (chave, valor) values (p_chave, btrim(p_valor))
  on conflict (chave) do update set valor = excluded.valor, updated_at = now();
  return 'guardado';
end $$;

-- ------------------------------------------------------------------
-- 2. registro do que aconteceu — para conferir depois, como no ManyChat
-- ------------------------------------------------------------------
create table if not exists public.google_sheets_log (
  log_id      bigserial primary key,
  lead_fk     uuid,
  planilha    text,
  aba         text,
  sucesso     boolean,
  detalhe     text,
  created_at  timestamptz not null default now()
);
alter table public.google_sheets_log enable row level security;
drop policy if exists gs_le on public.google_sheets_log;
create policy gs_le on public.google_sheets_log
  for select to authenticated using (public.papel_atual() is not null);
grant select on public.google_sheets_log to authenticated;
grant all on public.google_sheets_log to service_role;
grant usage, select on sequence public.google_sheets_log_log_id_seq to service_role;

-- ------------------------------------------------------------------
-- 3. o passo do motor: dispara e esquece, como o do ManyChat
-- ------------------------------------------------------------------
create or replace function public.executar_passo_planilha(
  p_lead uuid, p_config jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
begin
  if coalesce(public.segredo('google_refresh_token'), '') = '' then
    return 'conta Google não conectada';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key';
  end if;
  if coalesce(p_config->>'planilha_id', '') = ''
     or coalesce(p_config->>'aba', '') = '' then
    return 'passo sem planilha ou aba';
  end if;

  perform net.http_post(
    url := v_base || '/google-sheets',
    body := jsonb_build_object(
      'acao', 'acrescentar',
      'planilha_id', p_config->>'planilha_id',
      'aba', p_config->>'aba',
      'colunas', coalesce(p_config->'colunas', '[]'::jsonb),
      'mapeamento', coalesce(p_config->'mapeamento', '{}'::jsonb),
      'contato', public.payload_contato(p_lead)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.executar_passo_planilha(uuid, jsonb)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- 4. o executor aprende o modo novo (config com planilha_id).
-- Mesma técnica do corrige_tipos_de_passo: cirurgia no fonte vivo, com
-- guarda de idempotência e erro claro se a âncora tiver mudado de forma.
-- ------------------------------------------------------------------
do $$
declare
  v_src text;
  v_novo text;
begin
  select prosrc into v_src from pg_proc where proname = 'executar_automacoes';

  if position('executar_passo_planilha' in v_src) > 0 then
    raise notice 'executor já conhece o passo nativo de planilha';
    return;
  end if;

  v_novo := replace(v_src,
    'elsif v_passo.tipo in (''webhook'', ''google_sheets'', ''google_drive'') then',
    'elsif v_passo.tipo = ''google_sheets'' and (v_passo.config ? ''planilha_id'') then'
    || chr(10) || '        perform public.executar_passo_planilha(v_exec.lead_fk, v_passo.config);'
    || chr(10) || chr(10)
    || '      elsif v_passo.tipo in (''webhook'', ''google_sheets'', ''google_drive'') then');

  if v_novo = v_src then
    raise exception 'não achei o ramo de webhook/google_sheets — o executor mudou de forma';
  end if;

  execute 'create or replace function public.executar_automacoes() returns int '
       || 'language plpgsql security definer as $f$' || v_novo || '$f$';
end $$;

commit;

-- prova: o executor conhece o passo nativo E o legado continua lá
select
  (select position('executar_passo_planilha' in prosrc) > 0
   from pg_proc where proname = 'executar_automacoes')  as executor_conhece_nativo,
  (select position('''google_sheets''' in prosrc) > 0
   from pg_proc where proname = 'executar_automacoes')  as legado_continua,
  (select count(*) from pg_proc
   where proname = 'executar_passo_planilha')           as funcao_do_passo,
  (select count(*) from pg_proc
   where proname = 'guardar_segredo')                   as guardar_segredo_v2;
