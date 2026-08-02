-- =====================================================================
-- MOTOR v2 — importação de leads por CSV (server-side, com merge),
-- segmentos salvos resolvidos no banco e campanhas por segmento.
-- =====================================================================
begin;

-- ------------------ normalização de whatsapp (mesma regra do merge do AC) ------------------
create or replace function public.normalizar_whatsapp(p_raw text) returns text
language plpgsql immutable as $$
declare
  v text := ltrim(regexp_replace(coalesce(p_raw, ''), '\D', '', 'g'), '0');
  resto text;
begin
  if v = '' then return null; end if;
  if length(v) in (10, 11) then v := '55' || v; end if;
  if length(v) < 10 then return null; end if;
  resto := case when v like '55%' then substr(v, 3) else v end;
  if length(replace(resto, substr(resto, 1, 1), '')) = 0 then
    return null;                                   -- numero fake (digitos todos iguais)
  end if;
  return v;
end $$;

-- ------------------ importação de leads (lotes de até ~1000 por chamada) ------------------
create or replace function public.importar_leads(
  p_leads jsonb, p_lista int default null, p_tag int default null
) returns jsonb
language plpgsql security definer as $$
declare
  x jsonb;
  v_email text; v_nome text; v_cpf text; v_wa text;
  v_lead uuid;
  v_ins int := 0; v_upd int := 0; v_inv int := 0;
begin
  for x in select * from jsonb_array_elements(p_leads) loop
    begin
      v_email := lower(trim(coalesce(x->>'email', '')));
      if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
      v_nome  := nullif(trim(coalesce(x->>'nome', '')), '');
      v_cpf   := nullif(regexp_replace(coalesce(x->>'cpf', ''), '\D', '', 'g'), '');
      v_wa    := public.normalizar_whatsapp(x->>'whatsapp');

      if v_email is null and v_wa is null then
        v_inv := v_inv + 1;
        continue;
      end if;

      -- identidade: whatsapp primeiro, depois e-mail (mesma lógica da migração do AC)
      v_lead := null;
      if v_wa is not null then
        select lead_id into v_lead from public.tabela_1_leads where whatsapp = v_wa;
      end if;
      if v_lead is null and v_email is not null then
        select lead_id into v_lead from public.tabela_1_leads where lower(email) = v_email limit 1;
      end if;

      if v_lead is null then
        insert into public.tabela_1_leads (email, nome, whatsapp, cpf)
        values (v_email, v_nome, v_wa, v_cpf)
        returning lead_id into v_lead;
        v_ins := v_ins + 1;
      else
        update public.tabela_1_leads
        set nome = coalesce(v_nome, nome),
            email = coalesce(email, v_email),
            whatsapp = coalesce(whatsapp, v_wa),
            cpf = coalesce(cpf, v_cpf)
        where lead_id = v_lead;
        v_upd := v_upd + 1;
      end if;

      -- lista/tag do import disparam automações normalmente (triggers)
      if p_lista is not null then
        insert into public.lead_listas (lead_fk, lista_fk, status, source)
        values (v_lead, p_lista, 1, 'import_csv')
        on conflict (lead_fk, lista_fk) do nothing;
      end if;
      if p_tag is not null then
        insert into public.lead_tags (lead_fk, tag_fk)
        values (v_lead, p_tag)
        on conflict do nothing;
      end if;

    exception when others then
      v_inv := v_inv + 1;   -- ex.: cpf/whatsapp duplicado em outro lead
    end;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'invalidos', v_inv);
end $$;

-- ------------------ resolução de segmentos ------------------
-- definicao: { "lista_id": 17, "status_lista": 1, "tag_id": 65,
--              "whatsapp": "com"|"sem", "busca": "..." }  (todos opcionais)
create or replace function public.leads_do_segmento(p_def jsonb) returns setof uuid
language sql stable as $$
  select l.lead_id
  from public.tabela_1_leads l
  where ((p_def->>'lista_id') is null or exists (
          select 1 from public.lead_listas ll
          where ll.lead_fk = l.lead_id
            and ll.lista_fk = (p_def->>'lista_id')::int
            and ((p_def->>'status_lista') is null or ll.status = (p_def->>'status_lista')::int)))
    and ((p_def->>'tag_id') is null or exists (
          select 1 from public.lead_tags lt
          where lt.lead_fk = l.lead_id and lt.tag_fk = (p_def->>'tag_id')::int))
    and (coalesce(p_def->>'whatsapp','') <> 'com' or l.whatsapp is not null)
    and (coalesce(p_def->>'whatsapp','') <> 'sem' or l.whatsapp is null)
    and (coalesce(p_def->>'busca','') = ''
         or l.email ilike '%' || (p_def->>'busca') || '%'
         or l.nome ilike '%' || (p_def->>'busca') || '%'
         or l.whatsapp ilike '%' || (p_def->>'busca') || '%')
$$;

create or replace function public.contar_segmento(p_def jsonb) returns bigint
language sql stable as $$
  select count(*) from public.leads_do_segmento(p_def)
$$;

-- ------------------ campanhas agora aceitam segmento ------------------
create or replace function public.disparar_campanha(p_campanha uuid) returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_lead uuid;
  v_def jsonb;
  v_qtd int := 0;
begin
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.status not in ('draft','scheduled') then
    return 0;
  end if;
  update public.campanhas set status = 'sending', started_at = now() where campanha_id = p_campanha;

  if v_camp.segmento_fk is not null then
    select definicao into v_def from public.segmentos where segmento_id = v_camp.segmento_fk;
    for v_lead in select * from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) loop
      if public.enfileirar_email(v_lead, v_camp.mensagem_fk, p_campanha) is not null then
        v_qtd := v_qtd + 1;
      end if;
    end loop;
  else
    for v_lead in
      select distinct ll.lead_fk from public.lead_listas ll
      where ll.lista_fk = any(v_camp.lista_ids) and ll.status = 1
    loop
      if public.enfileirar_email(v_lead, v_camp.mensagem_fk, p_campanha) is not null then
        v_qtd := v_qtd + 1;
      end if;
    end loop;
  end if;
  return v_qtd;
end $$;

grant execute on all functions in schema public to service_role;
commit;
