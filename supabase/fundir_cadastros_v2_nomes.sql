-- =====================================================================
-- A PESSOA TEM MAIS DE UM NOME, COMO TEM MAIS DE UM E-MAIL
--
-- Ordem do dono (06/08/2026): "Vc nunca pode deletar uma pessoa que
-- comprou algo. No máximo fundir o cadastro com outro que tenhamos
-- certeza. (...) não deleta informações, some informações — a pessoa vai
-- ter mais de um email, por exemplo. Pode deixa um nome principal e um
-- secundário."
--
-- A fusão já movia tudo (compras, tags, listas, histórico) e já guardava
-- os dois e-mails. O que ainda se perdia de vista era o NOME do cadastro
-- absorvido: ele só sobrevivia no registro da fusão, longe da ficha da
-- pessoa. "Mara Alves" e "MARA ALVES SG" são a mesma pessoa escrita de
-- dois jeitos, e os dois jeitos têm valor — é por um deles que ela se
-- reconhece quando alguém do suporte a chama.
--
-- Agora cada endereço conhecido carrega o nome que veio junto com ele.
-- =====================================================================
begin;

alter table public.lead_emails
  add column if not exists nome text;

comment on column public.lead_emails.nome is
  'O nome que veio junto deste endereço. A pessoa pode se escrever de mais de um jeito.';

-- ------------------------------------------------------------------
-- registrar um e-mail visto passa a guardar o nome junto
-- ------------------------------------------------------------------
create or replace function public.registrar_email_do_lead(
  p_lead uuid, p_email text, p_origem text default null, p_nome text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') = '' then return; end if;
  if exists (select 1 from public.emails_da_operacao o
              where lower(o.email) = lower(trim(p_email))) then
    return;
  end if;

  insert into public.lead_emails (lead_fk, email, origem, nome)
  values (p_lead, lower(trim(p_email)), p_origem, nullif(trim(p_nome), ''))
  on conflict (lead_fk, email) do update
    set ultimo_em = now(),
        nome = coalesce(public.lead_emails.nome, excluded.nome);

  update public.tabela_1_leads
     set email = lower(trim(p_email))
   where lead_id = p_lead and coalesce(email, '') = '';
end $$;

grant execute on function public.registrar_email_do_lead(uuid, text, text, text)
  to authenticated, service_role;

-- a versão de 3 argumentos continua valendo (quem chama sem nome)
create or replace function public.registrar_email_do_lead(
  p_lead uuid, p_email text, p_origem text default null)
returns void
language sql security definer set search_path = public as $$
  select public.registrar_email_do_lead(p_lead, p_email, p_origem, null);
$$;

grant execute on function public.registrar_email_do_lead(uuid, text, text)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- a fusão guarda o nome do cadastro absorvido junto do e-mail dele
-- ------------------------------------------------------------------
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

  -- 1) o e-mail E O NOME de quem é absorvido não se perdem
  if coalesce(v_sai.email, '') <> ''
     and not exists (select 1 from public.emails_da_operacao o
                      where lower(o.email) = lower(v_sai.email)) then
    insert into public.lead_emails (lead_fk, email, origem, nome)
    values (p_fica, lower(trim(v_sai.email)), 'fusão de cadastro', nullif(trim(v_sai.nome), ''))
    on conflict (lead_fk, email) do update
      set nome = coalesce(public.lead_emails.nome, excluded.nome);
  end if;
  -- o nome de quem FICA também vira nome do e-mail dele, para os dois
  -- ficarem lado a lado na ficha
  if coalesce(v_fica.email, '') <> '' then
    insert into public.lead_emails (lead_fk, email, origem, nome)
    values (p_fica, lower(trim(v_fica.email)), 'principal', nullif(trim(v_fica.nome), ''))
    on conflict (lead_fk, email) do update
      set nome = coalesce(public.lead_emails.nome, excluded.nome);
  end if;

  -- 2) o que tem chave única: move o que não colide
  update public.lead_tags t set lead_fk = p_fica
   where t.lead_fk = p_sai
     and not exists (select 1 from public.lead_tags x
                      where x.lead_fk = p_fica and x.tag_fk = t.tag_fk);
  get diagnostics v_n = row_count; v_r := v_r || jsonb_build_object('tags', v_n);

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

  update public.lead_atributos a
     set dados = coalesce(s.dados, '{}'::jsonb) || coalesce(a.dados, '{}'::jsonb),
         updated_at = now()
    from public.lead_atributos s
   where s.lead_fk = p_sai and a.lead_fk = p_fica;
  update public.lead_atributos a set lead_fk = p_fica
   where a.lead_fk = p_sai
     and not exists (select 1 from public.lead_atributos x where x.lead_fk = p_fica);
  delete from public.lead_atributos where lead_fk = p_sai;

  delete from public.lead_pontuacao where lead_fk = p_sai
    and exists (select 1 from public.lead_pontuacao x where x.lead_fk = p_fica);
  update public.lead_pontuacao set lead_fk = p_fica where lead_fk = p_sai;
  delete from public.lead_venda where lead_fk = p_sai
    and exists (select 1 from public.lead_venda x where x.lead_fk = p_fica);
  update public.lead_venda set lead_fk = p_fica where lead_fk = p_sai;

  -- 3) o que não tem chave única: move tudo. NADA é apagado.
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

  -- 4) registra o que foi absorvido, e SÓ ENTÃO retira o cadastro vazio
  insert into public.fusoes_de_cadastro (ficou, saiu, email_saiu, nome_saiu, cpf, resumo)
  values (p_fica, p_sai, v_sai.email, v_sai.nome, coalesce(v_fica.cpf, v_sai.cpf), v_r);

  delete from public.tabela_1_leads where lead_id = p_sai;

  -- 5) só agora completa o que faltava em quem fica.
  --
  -- A ORDEM IMPORTA e custou sete fusões travadas: whatsapp, cpf e
  -- manychat_id são únicos na tabela. Copiar o número de quem é absorvido
  -- ENQUANTO ele ainda existe faz o número colidir com ele mesmo — o
  -- banco recusa, e a fusão morre no meio. Com o cadastro já retirado, o
  -- valor está livre. Os dados vêm de v_sai, que foi lido em memória lá
  -- no começo e sobrevive ao delete.
  update public.tabela_1_leads f set
    whatsapp    = coalesce(f.whatsapp, v_sai.whatsapp),
    cpf         = coalesce(f.cpf, v_sai.cpf),
    manychat_id = coalesce(f.manychat_id, v_sai.manychat_id),
    nome        = coalesce(nullif(trim(f.nome), ''), v_sai.nome)
   where f.lead_id = p_fica;

  return v_r || jsonb_build_object('ficou', p_fica, 'saiu', p_sai,
                                   'email_preservado', v_sai.email,
                                   'nome_preservado', v_sai.nome);
end $$;

revoke all on function public.fundir_cadastros(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fundir_cadastros(uuid, uuid) to service_role;

commit;

-- as quatro fusões de hoje ganham o nome que ficou só no registro
update public.lead_emails e
   set nome = f.nome_saiu
  from public.fusoes_de_cadastro f
 where e.lead_fk = f.ficou and lower(e.email) = lower(f.email_saiu) and e.nome is null;
