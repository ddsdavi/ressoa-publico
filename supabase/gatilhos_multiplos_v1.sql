-- =====================================================================
-- MAIS DE UM GATILHO POR AUTOMAÇÃO — como era no ActiveCampaign.
--
-- Uma automação de lançamento costuma ter várias portas de entrada: quem
-- entra na lista, quem ganha a tag, quem clica no e-mail. Com um gatilho
-- só, era preciso duplicar a automação inteira — e manter as duas em dia.
--
-- Como isto foi feito sem migrar nada: o campo `gatilho` passa a aceitar
-- TAMBÉM um array. Objeto continua valendo, exatamente como está nas 20
-- automações que já existem; array vale quando a tela mandar mais de um.
-- Quem normaliza é `gatilhos_de()`, e todas as quatro funções que liam o
-- campo passam por ela.
--
-- Esquecer uma dessas quatro seria pior do que não fazer nada: a automação
-- pareceria montada na tela e não dispararia por um dos gatilhos, ou uma
-- tag mesclada deixaria o gatilho apontando para uma tag que não existe
-- mais.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. objeto ou array, aqui vira sempre uma lista
-- ------------------------------------------------------------------
create or replace function public.gatilhos_de(p_gatilho jsonb)
returns setof jsonb
language sql immutable parallel safe as $$
  select valor from jsonb_array_elements(
    case
      when p_gatilho is null then '[]'::jsonb
      when jsonb_typeof(p_gatilho) = 'array' then p_gatilho
      else jsonb_build_array(p_gatilho)
    end) as t(valor)
$$;

grant execute on function public.gatilhos_de(jsonb) to authenticated, anon, service_role;

comment on function public.gatilhos_de(jsonb) is
  'Normaliza automacoes.gatilho: aceita objeto (formato antigo) ou array (vários gatilhos).';

-- ------------------------------------------------------------------
-- 2. o casamento evento → automação passa a olhar TODOS os gatilhos
-- ------------------------------------------------------------------
create or replace function public.processar_eventos_sistema() returns int
language plpgsql security definer as $$
declare
  v_evento record;
  v_auto record;
  v_hook record;
  v_qtd int := 0;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_evento in
    select * from public.eventos_sistema
    where processado_em is null
    order by evento_id
    limit 200
    for update skip locked
  loop
    for v_auto in
      -- distinct: dois gatilhos da mesma automação casando com o mesmo
      -- evento não podem criar duas execuções para a mesma pessoa
      select distinct a.automacao_id
      from public.automacoes a
      cross join lateral public.gatilhos_de(a.gatilho) as g
      where a.ativa
        and g->>'tipo' = v_evento.tipo
        and (
          (v_evento.tipo in ('lista_inscrita', 'lista_descadastrada') and (
             coalesce((g->>'qualquer_lista')::boolean, false)
             or g->>'lista_id' is null
             or (g->>'lista_id')::int = (v_evento.payload->>'lista_id')::int))
          or
          (v_evento.tipo = 'tag_adicionada' and
             (g->>'tag_id')::int = (v_evento.payload->>'tag_id')::int)
          or
          (v_evento.tipo in ('email_aberto', 'email_clicado') and (
             g->>'campanha_id' is null
             or g->>'campanha_id' = v_evento.payload->>'campanha_id'))
          or
          (v_evento.tipo in ('compra_realizada', 'carrinho_abandonado', 'boleto_gerado',
                             'pagamento_atrasado', 'pagamento_expirou') and (
             g->>'produto' is null
             or v_evento.payload->>'produto' ilike '%' || (g->>'produto') || '%'))
          or
          (v_evento.tipo = 'rss_novo_item' and (
             g->>'fonte_id' is null
             or (g->>'fonte_id')::int = (v_evento.payload->>'fonte_id')::int))
          or
          -- o evento de data já nasce endereçado à automação que o gerou
          (v_evento.tipo = 'data_do_contato'
             and a.automacao_id::text = v_evento.payload->>'automacao')
          or
          (v_evento.tipo not in ('lista_inscrita', 'lista_descadastrada', 'tag_adicionada',
                                 'email_aberto', 'email_clicado', 'compra_realizada',
                                 'carrinho_abandonado', 'boleto_gerado',
                                 'pagamento_atrasado', 'pagamento_expirou',
                                 'rss_novo_item', 'data_do_contato'))
        )
    loop
      if not exists (select 1 from public.automacao_execucoes e
                     where e.automacao_fk = v_auto.automacao_id
                       and e.lead_fk = v_evento.lead_fk
                       and e.status in ('em_andamento', 'aguardando', 'ativa')) then
        insert into public.automacao_execucoes
          (automacao_fk, lead_fk, passo_atual, agendado_para, contexto)
        values (v_auto.automacao_id, v_evento.lead_fk, 1, now(), v_evento.payload);
      end if;
    end loop;

    if v_webhooks then
      for v_hook in
        select * from public.webhooks_saida w where w.ativo and v_evento.tipo = any(w.eventos)
      loop
        perform net.http_post(
          url := v_hook.url,
          body := jsonb_build_object(
            'evento', v_evento.tipo, 'payload', v_evento.payload,
            'contato', case when v_evento.lead_fk is not null
                            then public.payload_contato(v_evento.lead_fk) end,
            'ocorrido_em', v_evento.created_at),
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'X-Webhook-Secret', coalesce(v_hook.secret, '')));
      end loop;
    end if;

    update public.eventos_sistema set processado_em = now() where evento_id = v_evento.evento_id;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- ------------------------------------------------------------------
-- 3. gatilho de data: um dos vários também precisa ser encontrado
-- ------------------------------------------------------------------
create or replace function public.verificar_datas() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  a record;
  v_campo text;
  v_antes int;
  v_alvo date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ano int := extract(year from v_hoje)::int;
  v_qtd int := 0;
  v_n int;
begin
  for a in
    -- `g as gatilho`: o corpo abaixo continua lendo a.gatilho, agora já
    -- resolvido para UM gatilho de data por vez
    select au.automacao_id, g as gatilho
    from public.automacoes au
    cross join lateral public.gatilhos_de(au.gatilho) as g
    where au.ativa and g->>'tipo' = 'data_do_contato'
  loop
    v_campo := a.gatilho->>'campo';
    if coalesce(v_campo, '') = '' then continue; end if;
    v_antes := coalesce((a.gatilho->>'dias_antes')::int, 0);
    v_alvo  := v_hoje + v_antes;      -- avisar N dias antes = olhar N dias à frente

    with candidatos as (
      select la.lead_fk, (la.dados ->> v_campo) as valor
      from public.lead_atributos la
      where la.dados ? v_campo and coalesce(la.dados ->> v_campo, '') <> ''
    ),
    -- data mal escrita não derruba a varredura inteira: quem não converte
    -- fica de fora e os outros seguem
    validos as (
      select lead_fk, valor,
             case when valor ~ '^\d{4}-\d{2}-\d{2}' then substring(valor, 1, 10)::date
                  when valor ~ '^\d{2}/\d{2}/\d{4}$' then to_date(valor, 'DD/MM/YYYY')
                  else null end as d
      from candidatos
    ),
    novos as (
      insert into public.eventos_sistema (tipo, lead_fk, payload)
      select 'data_do_contato', v.lead_fk,
             jsonb_build_object('campo', v_campo, 'data', v.d,
                                'dias_antes', v_antes,
                                'automacao', a.automacao_id)
      from validos v
      where v.d is not null
        and extract(month from v.d) = extract(month from v_alvo)
        and extract(day   from v.d) = extract(day   from v_alvo)
        and not exists (select 1 from public.data_disparos dd
                        where dd.automacao_fk = a.automacao_id
                          and dd.lead_fk = v.lead_fk and dd.ano = v_ano)
      returning lead_fk
    )
    insert into public.data_disparos (automacao_fk, lead_fk, ano)
    select a.automacao_id, lead_fk, v_ano from novos
    on conflict do nothing;

    get diagnostics v_n = row_count;
    v_qtd := v_qtd + v_n;
  end loop;
  return v_qtd;
end $$;

-- ------------------------------------------------------------------
-- 4. mesclar tags reaponta o gatilho, esteja ele sozinho ou numa lista
-- ------------------------------------------------------------------
create or replace function public.mesclar_tags(p_origens integer[], p_destino integer)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_movidos int := 0;
  v_autos int := 0;
  v_passos int := 0;
  v_origens int[] := array(select unnest(p_origens) except select p_destino);
begin
  if p_destino is null or v_origens = '{}' then
    return jsonb_build_object('erro', 'escolha ao menos uma tag de origem e uma de destino');
  end if;
  if not exists (select 1 from public.tags where tag_id = p_destino) then
    return jsonb_build_object('erro', 'a tag de destino não existe');
  end if;

  -- contatos das origens passam para o destino, sem duplicar quem já tem
  insert into public.lead_tags (lead_fk, tag_fk, created_at)
  select lt.lead_fk, p_destino, min(lt.created_at)
  from public.lead_tags lt
  where lt.tag_fk = any(v_origens)
  group by lt.lead_fk
  on conflict (lead_fk, tag_fk) do nothing;
  get diagnostics v_movidos = row_count;

  -- automações que usavam as origens passam a usar o destino, trocando só
  -- o gatilho que aponta para a tag mesclada e deixando os outros intactos
  update public.automacoes a
  set gatilho = case
    when jsonb_typeof(a.gatilho) = 'array' then (
      select jsonb_agg(
        case when g->>'tipo' = 'tag_adicionada'
              and (g->>'tag_id')::int = any(v_origens)
             then jsonb_set(g, '{tag_id}', to_jsonb(p_destino))
             else g end)
      from jsonb_array_elements(a.gatilho) as g)
    else jsonb_set(a.gatilho, '{tag_id}', to_jsonb(p_destino))
  end
  where exists (
    select 1 from public.gatilhos_de(a.gatilho) as g
    where g->>'tipo' = 'tag_adicionada'
      and (g->>'tag_id')::int = any(v_origens));
  get diagnostics v_autos = row_count;

  update public.automacao_passos
  set config = jsonb_set(config, '{tag_id}', to_jsonb(p_destino))
  where tipo in ('aplicar_tag', 'remover_tag')
    and (config->>'tag_id')::int = any(v_origens);
  get diagnostics v_passos = row_count;

  delete from public.lead_tags where tag_fk = any(v_origens);
  delete from public.tags where tag_id = any(v_origens);

  return jsonb_build_object(
    'contatos_movidos', v_movidos,
    'automacoes_reapontadas', v_autos,
    'passos_reapontados', v_passos,
    'tags_removidas', array_length(v_origens, 1));
end $$;

-- ------------------------------------------------------------------
-- 5. o relatório de tags também enxerga a tag dentro de uma lista
-- ------------------------------------------------------------------
create or replace function public.rel_tags()
returns table(tag text, leads bigint, percentual numeric, com_email bigint,
              engajados bigint, usada_em_automacao boolean)
language sql stable security definer set search_path to 'public' as $$
  with base as (select count(*)::numeric as n from public.tabela_1_leads)
  select t.nome,
         count(lt.lead_fk),
         round(100.0 * count(lt.lead_fk) / nullif((select n from base), 0), 1),
         count(lt.lead_fk) filter (where l.email is not null),
         count(lt.lead_fk) filter (where coalesce(p.pontos, 0) >= 20),
         exists (select 1 from public.automacoes a
                 cross join lateral public.gatilhos_de(a.gatilho) as g
                 where (g->>'tag_id')::int = t.tag_id
                 union all
                 select 1 from public.automacao_passos ap
                 where (ap.config->>'tag_id')::int = t.tag_id)
  from public.tags t
  left join public.lead_tags lt on lt.tag_fk = t.tag_id
  left join public.tabela_1_leads l on l.lead_id = lt.lead_fk
  left join public.lead_pontuacao p on p.lead_fk = lt.lead_fk
  group by t.tag_id, t.nome
  order by 2 desc
$$;

commit;

-- prova: o formato antigo continua casando, e o novo passa a casar também
with amostra as (
  select '{"tipo":"tag_adicionada","tag_id":85}'::jsonb as antigo,
         '[{"tipo":"tag_adicionada","tag_id":85},
           {"tipo":"lista_inscrita","lista_id":6}]'::jsonb as novo
)
select
  (select count(*) from amostra, public.gatilhos_de(antigo))      as gatilhos_no_formato_antigo,
  (select count(*) from amostra, public.gatilhos_de(novo))        as gatilhos_no_formato_novo,
  (select count(*) from public.gatilhos_de(null))                 as gatilho_vazio,
  (select count(*) from public.automacoes
   where ativa and jsonb_typeof(gatilho) = 'array')               as automacoes_ja_com_varios,
  (select position('gatilhos_de' in prosrc) > 0
   from pg_proc where proname = 'processar_eventos_sistema')      as motor_atualizado;
