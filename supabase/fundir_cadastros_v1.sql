-- =====================================================================
-- FUNDIR DOIS CADASTROS DA MESMA PESSOA
--
-- A mesma pessoa comprando com dois e-mails vira dois cadastros. Depois
-- que o CPF passou a ser gravado (email_da_compra_v1), dá para provar
-- que são a mesma — e juntar.
--
-- POR QUE ISSO PRECISA SER UMA FUNÇÃO, e não um punhado de UPDATEs:
-- dezoito tabelas apontam para um cadastro, e a maioria com CASCADE.
-- Apagar o cadastro que sai antes de mover o que está pendurado nele
-- levaria compras, tags e histórico junto, em silêncio. Aqui a ordem é
-- garantida e tudo acontece numa transação só.
--
-- O QUE MANDA: o cadastro que FICA. Ele só recebe do outro o que estiver
-- faltando (whatsapp, cpf, id do ManyChat, nome) — nunca sobrescreve o
-- que já tem. E o e-mail de quem sai não se perde: vira endereço
-- conhecido da pessoa em lead_emails, porque é por ele que a
-- comunicação de algumas compras vai sair (regra do e-mail da compra).
-- =====================================================================
begin;

create table if not exists public.fusoes_de_cadastro (
  fusao_id    uuid primary key default gen_random_uuid(),
  ficou       uuid not null,
  saiu        uuid not null,
  email_saiu  text,
  nome_saiu   text,
  cpf         text,
  resumo      jsonb,
  quando      timestamptz not null default now()
);

comment on table public.fusoes_de_cadastro is
  'Registro de cada fusão: o que foi juntado, quando, e o que veio de onde.';

alter table public.fusoes_de_cadastro enable row level security;

drop policy if exists fusoes_leitura on public.fusoes_de_cadastro;
create policy fusoes_leitura on public.fusoes_de_cadastro
  for select to authenticated using (public.papel_atual() is not null);

create or replace function public.fundir_cadastros(p_fica uuid, p_sai uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fica record;
  v_sai  record;
  v_r    jsonb := '{}'::jsonb;
  v_n    int;
begin
  if p_fica = p_sai then
    raise exception 'os dois cadastros são o mesmo';
  end if;

  select * into v_fica from public.tabela_1_leads where lead_id = p_fica;
  if not found then raise exception 'cadastro que fica não existe'; end if;
  select * into v_sai  from public.tabela_1_leads where lead_id = p_sai;
  if not found then raise exception 'cadastro que sai não existe'; end if;

  -- ---- 1. o e-mail de quem sai não se perde ----
  -- É por ele que a comunicação de algumas compras vai sair.
  if coalesce(v_sai.email, '') <> ''
     and not exists (select 1 from public.emails_da_operacao o
                      where lower(o.email) = lower(v_sai.email)) then
    insert into public.lead_emails (lead_fk, email, origem)
    values (p_fica, lower(trim(v_sai.email)), 'fusão de cadastro')
    on conflict (lead_fk, email) do nothing;
  end if;

  -- ---- 2. o que tem chave única: move o que não colide ----
  -- Colisão aqui não é perda: quer dizer que os dois já tinham a mesma
  -- tag, a mesma lista, a mesma participação.
  update public.lead_tags t set lead_fk = p_fica
   where t.lead_fk = p_sai
     and not exists (select 1 from public.lead_tags x
                      where x.lead_fk = p_fica and x.tag_fk = t.tag_fk);
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('tags', v_n);

  -- na lista, o status mais engajado vence (1 = inscrito)
  update public.lead_listas l set lead_fk = p_fica
   where l.lead_fk = p_sai
     and not exists (select 1 from public.lead_listas x
                      where x.lead_fk = p_fica and x.lista_fk = l.lista_fk);
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('listas', v_n);
  update public.lead_listas x set status = 1, updated_at = now()
    from public.lead_listas s
   where s.lead_fk = p_sai and x.lead_fk = p_fica and x.lista_fk = s.lista_fk
     and s.status = 1 and x.status <> 1;

  update public.lead_emails e set lead_fk = p_fica
   where e.lead_fk = p_sai
     and not exists (select 1 from public.lead_emails x
                      where x.lead_fk = p_fica and x.email = e.email);
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('emails', v_n);

  update public.tabela_2_participacoes p set lead_fk = p_fica
   where p.lead_fk = p_sai
     and not exists (select 1 from public.tabela_2_participacoes x
                      where x.lead_fk = p_fica and x.evento_origem = p.evento_origem);
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('participacoes', v_n);

  update public.tabela_3_precheckout t set lead_fk = p_fica
   where t.lead_fk = p_sai
     and not exists (select 1 from public.tabela_3_precheckout x
                      where x.lead_fk = p_fica and x.produto is not distinct from t.produto
                        and x.evento_origem is not distinct from t.evento_origem);
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('precheckout', v_n);

  -- atributos: junta os dois jsonb, o de quem fica prevalece
  update public.lead_atributos a
     set dados = coalesce(s.dados, '{}'::jsonb) || coalesce(a.dados, '{}'::jsonb),
         updated_at = now()
    from public.lead_atributos s
   where s.lead_fk = p_sai and a.lead_fk = p_fica;
  update public.lead_atributos a set lead_fk = p_fica
   where a.lead_fk = p_sai
     and not exists (select 1 from public.lead_atributos x where x.lead_fk = p_fica);
  delete from public.lead_atributos where lead_fk = p_sai;

  -- pontuação e resumo de venda são recalculáveis; fica o de quem fica
  delete from public.lead_pontuacao where lead_fk = p_sai
    and exists (select 1 from public.lead_pontuacao x where x.lead_fk = p_fica);
  update public.lead_pontuacao set lead_fk = p_fica where lead_fk = p_sai;
  delete from public.lead_venda where lead_fk = p_sai
    and exists (select 1 from public.lead_venda x where x.lead_fk = p_fica);
  update public.lead_venda set lead_fk = p_fica where lead_fk = p_sai;

  -- ---- 3. o que não tem chave única: move tudo ----
  update public.tabela_4_alunos set lead_fk = p_fica where lead_fk = p_sai;
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('compras', v_n);

  update public.envios              set lead_fk = p_fica where lead_fk = p_sai;
  update public.eventos_email       set lead_fk = p_fica where lead_fk = p_sai;
  update public.eventos_sistema     set lead_fk = p_fica where lead_fk = p_sai;
  update public.automacao_execucoes set lead_fk = p_fica where lead_fk = p_sai;
  update public.manychat_log        set lead_fk = p_fica where lead_fk = p_sai;
  update public.google_sheets_log   set lead_fk = p_fica where lead_fk = p_sai;
  update public.lead_notas          set lead_fk = p_fica where lead_fk = p_sai;
  update public.data_disparos       set lead_fk = p_fica where lead_fk = p_sai;
  update public.ac_contacts         set lead_fk = p_fica where lead_fk = p_sai;

  -- ---- 4. completa o que faltava em quem fica ----
  update public.tabela_1_leads f set
    whatsapp    = coalesce(f.whatsapp, v_sai.whatsapp),
    cpf         = coalesce(f.cpf, v_sai.cpf),
    manychat_id = coalesce(f.manychat_id, v_sai.manychat_id),
    nome        = coalesce(nullif(trim(f.nome), ''), v_sai.nome)
   where f.lead_id = p_fica;

  -- ---- 5. registra e só então apaga ----
  insert into public.fusoes_de_cadastro (ficou, saiu, email_saiu, nome_saiu, cpf, resumo)
  values (p_fica, p_sai, v_sai.email, v_sai.nome, coalesce(v_fica.cpf, v_sai.cpf), v_r);

  delete from public.tabela_1_leads where lead_id = p_sai;

  return v_r || jsonb_build_object('ficou', p_fica, 'saiu', p_sai,
                                   'email_preservado', v_sai.email);
end $$;

revoke all on function public.fundir_cadastros(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fundir_cadastros(uuid, uuid) to service_role;

comment on function public.fundir_cadastros(uuid, uuid) is
  'Junta dois cadastros da mesma pessoa. Move tudo antes de apagar; o e-mail de quem sai vira endereço conhecido.';

commit;
