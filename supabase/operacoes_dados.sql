-- =====================================================================
-- REGISTRO DE IMPORTAÇÕES E EXPORTAÇÕES
--
-- Toda importação e toda exportação de leads passa a deixar rastro: quem
-- fez, quando, quantos contatos, quantas falhas. Sem isso, "sumiu gente
-- da lista" vira investigação sem ponto de partida — e exportação de base
-- de 12 mil pessoas é justamente o que precisa de rastro (LGPD).
--
-- O arquivo exportado fica guardado por 7 dias, igual ao ActiveCampaign.
-- Depois disso o registro continua, e dá para GERAR DE NOVO a partir do
-- filtro salvo — o que é melhor do que o AC, onde o arquivo expirado
-- simplesmente some.
-- =====================================================================
begin;

create table if not exists public.operacoes_dados (
  operacao_id  uuid primary key default gen_random_uuid(),
  direcao      text not null check (direcao in ('importacao', 'exportacao')),
  nome         text not null,
  autor_email  text,
  total        int  not null default 0,
  falhas       int  not null default 0,
  status       text not null default 'processando'
               check (status in ('processando', 'completo', 'erro')),
  filtro       jsonb,          -- para refazer a exportação depois
  detalhes     jsonb,          -- erros linha a linha, listas/tags aplicadas
  arquivo      text,           -- caminho no bucket (só exportação)
  expira_em    timestamptz,
  created_at   timestamptz not null default now(),
  finalizado_em timestamptz
);
create index if not exists ix_operacoes_dir on public.operacoes_dados (direcao, created_at desc);

alter table public.operacoes_dados enable row level security;

drop policy if exists ops_leitura on public.operacoes_dados;
create policy ops_leitura on public.operacoes_dados
  for select to authenticated using (public.papel_atual() is not null);

-- quem pode preparar dados pode registrar a operação que acabou de fazer
drop policy if exists ops_escrita on public.operacoes_dados;
create policy ops_escrita on public.operacoes_dados
  for insert to authenticated
  with check (public.papel_atual() in ('admin', 'terapeuta', 'assistente'));

drop policy if exists ops_atualiza on public.operacoes_dados;
create policy ops_atualiza on public.operacoes_dados
  for update to authenticated
  using (public.papel_atual() in ('admin', 'terapeuta', 'assistente'));

grant select, insert, update on public.operacoes_dados to authenticated;

-- ------------------ bucket dos arquivos exportados ------------------
-- privado: são dados pessoais de milhares de pessoas, nunca públicos
insert into storage.buckets (id, name, public, file_size_limit)
values ('exportacoes', 'exportacoes', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists export_le on storage.objects;
create policy export_le on storage.objects
  for select to authenticated
  using (bucket_id = 'exportacoes' and public.papel_atual() in ('admin', 'terapeuta'));

drop policy if exists export_grava on storage.objects;
create policy export_grava on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exportacoes' and public.papel_atual() in ('admin', 'terapeuta'));

drop policy if exists export_apaga on storage.objects;
create policy export_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'exportacoes' and public.papel_atual() = 'admin');

-- ------------------ faxina diária dos arquivos vencidos ------------------
create or replace function public.limpar_exportacoes_vencidas() returns int
language plpgsql security definer set search_path = public as $$
declare v_qtd int := 0;
begin
  delete from storage.objects
  where bucket_id = 'exportacoes'
    and name in (select arquivo from public.operacoes_dados
                 where arquivo is not null and expira_em < now());
  get diagnostics v_qtd = row_count;
  -- o registro fica: some o arquivo, não o histórico de quem exportou
  update public.operacoes_dados set arquivo = null
  where arquivo is not null and expira_em < now();
  return v_qtd;
end $$;

select cron.schedule('faxina-exportacoes', '17 4 * * *',
                     'select public.limpar_exportacoes_vencidas()')
where not exists (select 1 from cron.job where jobname = 'faxina-exportacoes');

commit;

select (select count(*) from public.operacoes_dados) as registros,
       (select count(*) from storage.buckets where id = 'exportacoes') as bucket_criado,
       (select count(*) from cron.job where jobname = 'faxina-exportacoes') as faxina_agendada;
