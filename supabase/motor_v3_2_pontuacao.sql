-- MOTOR v3.2 — pontuação como condição de segmento.
-- Reaplica leads_do_segmento()/contar_segmento() com a condição nova.
begin;

alter table public.mensagens add column if not exists design jsonb;

create or replace function public.leads_do_segmento(p_def jsonb) returns setof uuid
language plpgsql stable as $$
declare
  v_cond jsonb;
  v_preds text[] := '{}';
  v_pred text;
  v_sql text;
begin
  -- ---------- formato v1 (compatibilidade com os filtros rápidos) ----------
  if p_def is null or not (p_def ? 'condicoes') then
    return query
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
           or l.whatsapp ilike '%' || (p_def->>'busca') || '%');
    return;
  end if;

  -- ---------- formato v2 ----------
  for v_cond in select * from jsonb_array_elements(p_def->'condicoes') loop
    v_pred := null;
    case v_cond->>'campo'
      when 'lista' then
        v_pred := format(
          'exists (select 1 from public.lead_listas ll where ll.lead_fk = l.lead_id and ll.lista_fk = %s%s)',
          (v_cond->>'lista_id')::int,
          case when v_cond ? 'status' and (v_cond->>'status') <> ''
               then format(' and ll.status = %s', (v_cond->>'status')::int) else '' end);
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;
      when 'tag' then
        v_pred := format(
          'exists (select 1 from public.lead_tags lt where lt.lead_fk = l.lead_id and lt.tag_fk = %s)',
          (v_cond->>'tag_id')::int);
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;
      when 'whatsapp' then
        v_pred := case when coalesce((v_cond->>'tem')::boolean, true)
                       then 'l.whatsapp is not null' else 'l.whatsapp is null' end;
      when 'busca' then
        v_pred := format('(l.email ilike %L or l.nome ilike %L or l.whatsapp ilike %L)',
          '%' || (v_cond->>'valor') || '%', '%' || (v_cond->>'valor') || '%', '%' || (v_cond->>'valor') || '%');
      when 'email_dominio' then
        v_pred := format('l.email ilike %L', '%@' || ltrim(coalesce(v_cond->>'valor',''), '@'));
      when 'participacao' then
        v_pred := format(
          'exists (select 1 from public.tabela_2_participacoes p where p.lead_fk = l.lead_id and p.evento_origem ilike %L)',
          '%' || (v_cond->>'valor') || '%');
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;
      when 'atributo' then
        v_pred := format(
          'exists (select 1 from public.lead_atributos a where a.lead_fk = l.lead_id and a.dados->>%L ilike %L)',
          v_cond->>'chave', '%' || coalesce(v_cond->>'valor','') || '%');
      when 'abriu_email' then
        v_pred := format(
          'exists (select 1 from public.eventos_email ev where ev.lead_fk = l.lead_id and ev.tipo = ''open'' and ev.occurred_at > now() - make_interval(days => %s))',
          coalesce(v_cond->>'dias','30')::int);
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;
      when 'clicou_email' then
        v_pred := format(
          'exists (select 1 from public.eventos_email ev where ev.lead_fk = l.lead_id and ev.tipo = ''click'' and ev.occurred_at > now() - make_interval(days => %s))',
          coalesce(v_cond->>'dias','30')::int);
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;
      when 'nao_suprimido' then
        v_pred := '(l.email is null or not exists (select 1 from public.supressao s where s.email = l.email))';

      -- pontuação: quem está acima (ou abaixo) de um valor. É o que responde
      -- "por quem eu começo o aquecimento" sem precisar exportar planilha.
      when 'pontuacao' then
        v_pred := format(
          '(select coalesce(p.pontos, 0) from public.lead_pontuacao p where p.lead_fk = l.lead_id) %s %s',
          case when coalesce(v_cond->>'operador', 'maior') = 'menor' then '<=' else '>=' end,
          coalesce((v_cond->>'valor')::int, 0));
      else
        v_pred := null;
    end case;
    if v_pred is not null then
      v_preds := v_preds || v_pred;
    end if;
  end loop;

  if array_length(v_preds, 1) is null then
    return query select l.lead_id from public.tabela_1_leads l;
    return;
  end if;

  v_sql := 'select l.lead_id from public.tabela_1_leads l where '
           || array_to_string(v_preds,
                case when lower(coalesce(p_def->>'op','and')) = 'or' then ' or ' else ' and ' end);
  return query execute v_sql;
end $$;

grant execute on all functions in schema public to service_role;
commit;
