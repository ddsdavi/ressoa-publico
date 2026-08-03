-- =====================================================================
-- VENDAS v2 — importação histórica sem misturar pessoas.
--
-- O relatório da Hotmart sempre traz e-mail, mas o importador antigo:
--   1. procurava o e-mail com comparação sensível a maiúsculas;
--   2. preferia o telefone mesmo quando ele pertencia a outro e-mail;
--   3. informava toda gravação como atualização, mesmo em linha nova.
--
-- Num lote histórico isso pode anexar a compra à pessoa errada ou parar
-- por violação da chave única lower(email). O e-mail passa a ser a chave
-- principal; telefone só é usado quando não contradiz o e-mail.
-- =====================================================================
begin;

alter table public.tabela_4_alunos
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.importar_vendas(p_vendas jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_lead uuid;
  v_lead_email uuid;
  v_lead_fone uuid;
  v_email_do_fone text;
  v_email text;
  v_fone text;
  v_transacao text;
  v_compra_existe boolean;
  v_novas int := 0;
  v_atualizadas int := 0;
  v_sem_lead int := 0;
  v_leads_novos int := 0;
begin
  for v in select * from jsonb_array_elements(p_vendas) loop
    v_email := lower(nullif(trim(v->>'email'), ''));
    v_fone := public.normalizar_whatsapp(v->>'telefone');
    v_lead := null;
    v_lead_email := null;
    v_lead_fone := null;
    v_email_do_fone := null;

    if v_email is not null then
      select lead_id into v_lead_email
      from public.tabela_1_leads
      where lower(email) = v_email
      limit 1;
    end if;

    if v_fone is not null then
      select lead_id, lower(email) into v_lead_fone, v_email_do_fone
      from public.tabela_1_leads
      where whatsapp = v_fone
      limit 1;
    end if;

    -- E-mail exato do relatório ganha. O telefone só identifica sozinho
    -- quando não contradiz o e-mail informado pela Hotmart.
    if v_lead_email is not null then
      v_lead := v_lead_email;
    elsif v_lead_fone is not null
          and (v_email is null or v_email_do_fone is null or v_email_do_fone = v_email) then
      v_lead := v_lead_fone;
    end if;

    if v_lead is null and v_email is not null then
      -- Se o telefone já pertence a outro e-mail, cria o comprador sem
      -- esse número. É melhor um telefone ausente que juntar duas pessoas.
      if v_lead_fone is not null and v_email_do_fone is distinct from v_email then
        v_fone := null;
      end if;

      insert into public.tabela_1_leads (nome, email, whatsapp)
      values (nullif(trim(v->>'nome'), ''), v_email, v_fone)
      returning lead_id into v_lead;
      v_leads_novos := v_leads_novos + 1;
    end if;

    if v_lead is null then
      v_sem_lead := v_sem_lead + 1;
      continue;
    end if;

    v_transacao := coalesce(
      nullif(trim(v->>'codigo_transacao'), ''),
      md5(coalesce(v_email,'') || coalesce(v->>'produto','') || coalesce(v->>'data',''))
    );
    select exists (
      select 1 from public.tabela_4_alunos where codigo_transacao = v_transacao
    ) into v_compra_existe;

    insert into public.tabela_4_alunos (
      lead_fk, codigo_transacao, nome_produto, valor, moeda,
      forma_de_pagamento, status, data_compra, parcelas, evento_origem, origem)
    values (
      v_lead,
      v_transacao,
      coalesce(nullif(trim(v->>'produto'), ''), 'produto sem nome'),
      coalesce((v->>'valor')::numeric, 0),
      coalesce(nullif(v->>'moeda',''), 'BRL'),
      nullif(trim(v->>'pagamento'), ''),
      coalesce(nullif(v->>'status',''), 'aprovada'),
      coalesce((v->>'data')::timestamptz, now()),
      (v->>'parcelas')::int,
      nullif(trim(v->>'evento'), ''),
      coalesce(nullif(v->>'origem',''), 'hotmart'))
    on conflict (codigo_transacao) do update
      set lead_fk = excluded.lead_fk,
          status = excluded.status,
          valor = excluded.valor,
          moeda = excluded.moeda,
          forma_de_pagamento = coalesce(excluded.forma_de_pagamento,
                                        tabela_4_alunos.forma_de_pagamento),
          nome_produto = excluded.nome_produto,
          data_compra = excluded.data_compra,
          parcelas = coalesce(excluded.parcelas, tabela_4_alunos.parcelas),
          evento_origem = coalesce(excluded.evento_origem, tabela_4_alunos.evento_origem),
          origem = coalesce(excluded.origem, tabela_4_alunos.origem),
          updated_at = now();

    if v_compra_existe then
      v_atualizadas := v_atualizadas + 1;
    else
      v_novas := v_novas + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'gravadas', v_novas + v_atualizadas,
    'novas', v_novas,
    'atualizadas', v_atualizadas,
    'leads_criados', v_leads_novos,
    'sem_email', v_sem_lead);
end $$;

grant execute on function public.importar_vendas(jsonb) to authenticated;

commit;

select position('lower(email) = v_email' in prosrc) > 0 as email_sem_diferenca_de_caixa,
       position('v_email_do_fone is distinct from v_email' in prosrc) > 0 as bloqueia_fone_de_outra_pessoa
from pg_proc where proname = 'importar_vendas';
