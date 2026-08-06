-- =====================================================================
-- PONTUAÇÃO DE VENDA v1 — o segundo eixo.
--
-- "Vendas é uma coisa e engajamento com e-mail é outra" (Davi, 06/08/2026).
-- O `pontos` de lead_pontuacao continua sendo o eixo de SAÚDE DE ENVIO
-- (por quem começar o aquecimento). Este arquivo cria o eixo de VENDA:
-- quem está mais perto de comprar, e O QUE oferecer para cada pessoa.
--
-- Três decisões que mudam o resultado:
--
--   1. O número é CONTÍNUO (decaimento exponencial sobre a data real da
--      última compra), não soma de regras binárias. Regra binária empata
--      milhares de pessoas no mesmo valor — foi o que saturou o eixo de
--      engajamento: 57% da base no "topo", 2.604 pessoas empatadas em 11
--      pontos. Empate não ordena, e ordenar é o serviço deste número.
--
--   2. A meia-vida do decaimento é ~31 dias (45·exp(−dias/45)) porque a
--      esteira REAL é rápida: medido no histórico, 79% dos alunos da
--      Formação compraram um produto de entrada antes, com mediana de
--      5,6 a 10,8 dias entre uma coisa e outra; a 2ª compra de quem
--      recompra tem mediana no MESMO DIA e p75 de 11 dias. Quem comprou
--      há duas semanas está em brasa; há três meses, morno.
--
--   3. As faixas são por PERCENTIL entre os alcançáveis, não por corte
--      fixo. Corte fixo satura de novo conforme a base muda; o top 5%
--      é top 5% para sempre.
--
--   E nenhum sinal de e-mail entra aqui, de propósito: abrir e clicar
--   moram no outro eixo. Compra, recência, gasto, lives e entrada na
--   base é o que este número enxerga.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. a foto de venda de cada lead
-- ------------------------------------------------------------------
create table if not exists public.lead_venda (
  lead_fk        uuid primary key references public.tabela_1_leads(lead_id) on delete cascade,
  pontos_venda   int not null default 0,
  faixa          text not null default 'frio',
  proxima_oferta text not null default 'aquecer_primeiro',
  motivo         text,
  ultima_compra  date,
  compras        int not null default 0,
  gasto_total    numeric not null default 0,
  alcancavel     boolean not null default false,
  calculado_em   timestamptz not null default now()
);
create index if not exists ix_lead_venda_pontos on public.lead_venda (pontos_venda desc);
create index if not exists ix_lead_venda_oferta on public.lead_venda (proxima_oferta);

alter table public.lead_venda enable row level security;
drop policy if exists lead_venda_le on public.lead_venda;
create policy lead_venda_le on public.lead_venda
  for select to authenticated using (public.papel_atual() is not null);
grant select on public.lead_venda to authenticated;
grant all on public.lead_venda to service_role;

-- cortes de faixa gravados pelo recálculo completo, para o recálculo
-- pontual (trigger de compra) reutilizar sem recomputar percentil.
-- RLS ligado sem policy: tabela interna, invisível para a aplicação.
create table if not exists public.venda_cortes (
  nome  text primary key,
  corte int not null
);
alter table public.venda_cortes enable row level security;
grant all on public.venda_cortes to service_role;

-- ------------------------------------------------------------------
-- 2. o recálculo. Completo (p_lead null): recomputa todo mundo, os
-- cortes de percentil e as faixas. Pontual (p_lead dado): só aquela
-- pessoa, com os cortes já gravados — é o caminho do trigger de compra.
-- Nome único, sem sobrecarga: três assinaturas de aplicar_mapa_produto
-- já derrubaram o processamento de venda uma vez (PGRST203).
-- ------------------------------------------------------------------
create or replace function public.recalcular_pontuacao_venda(p_lead uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_qtd int;
  v_c1 int; v_c2 int; v_c3 int;
begin
  with base as (
    select l.lead_id, l.email,
           -- data real de entrada: created_at ou tag mais recente (as datas
           -- de lista têm resíduo da importação — lição da pontuação v1.2)
           greatest(l.created_at,
             coalesce((select max(lt.created_at) from public.lead_tags lt
                       where lt.lead_fk = l.lead_id), l.created_at)) as entrada
    from public.tabela_1_leads l
    where p_lead is null or l.lead_id = p_lead
  ),
  comp as (
    select c.lead_fk,
           count(*) as compras,
           coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0) as gasto,
           max(coalesce(c.data_compra, c.created_at)) as ultima,
           bool_or(c.nome_produto ilike '%Formação em Biorressonância Aplicada%') as tem_formacao,
           bool_or(c.nome_produto ilike '%Black Ressonante%')                     as tem_black,
           bool_or(c.nome_produto ilike '%Acompanhamento Ressonante%')            as tem_acomp
    from public.tabela_4_alunos c
    where c.status = 'aprovada'
      and (p_lead is null or c.lead_fk = p_lead)
    group by 1
  ),
  extras as (
    select b.lead_id,
           exists (select 1 from public.tabela_4_alunos c2
                   where c2.lead_fk = b.lead_id
                     and c2.status in ('reembolsada','chargeback')) as tem_reembolso,
           exists (select 1 from public.lead_listas lv
                   where lv.lead_fk = b.lead_id and lv.lista_fk = 6
                     and lv.status = 1) as lives,
           (select count(*) from public.tabela_2_participacoes tp
            where tp.lead_fk = b.lead_id) as participacoes,
           (b.email is not null
             and not exists (select 1 from public.supressao s where s.email = b.email)
             and exists (select 1 from public.lead_listas la
                         where la.lead_fk = b.lead_id and la.status = 1)) as alcancavel
    from base b
  ),
  calc as (
    select b.lead_id,
           coalesce(co.compras, 0) as compras,
           coalesce(co.gasto, 0)   as gasto,
           co.ultima,
           coalesce(co.tem_formacao, false) as tem_formacao,
           (coalesce(co.tem_black, false) or coalesce(co.tem_acomp, false)) as tem_topo,
           e.tem_reembolso, e.lives, e.alcancavel,
           case when co.ultima is not null
                then floor(extract(epoch from (now() - co.ultima)) / 86400)::int end as dias_compra,
           floor(extract(epoch from (now() - b.entrada)) / 86400)::int as dias_entrada,
           greatest(0, least(100,
             case when coalesce(co.compras, 0) > 0 then
                 -- comprador: recência com decaimento + frequência + gasto
                 round(45 * exp(-(extract(epoch from (now() - co.ultima)) / 86400.0) / 45.0))::int
               + least(co.compras, 5) * 4
               + case when co.gasto >= 1500 then 15
                      when co.gasto >= 800  then 12
                      when co.gasto >= 300  then 9
                      when co.gasto >= 100  then 6
                      when co.gasto >= 40   then 4
                      when co.gasto > 0     then 2
                      else 0 end
             else
                 -- sem compra: o que separa as pessoas é há quanto tempo entraram
                 case when b.entrada > now() - interval '30 days'  then 12
                      when b.entrada > now() - interval '90 days'  then 8
                      when b.entrada > now() - interval '180 days' then 5
                      when b.entrada > now() - interval '365 days' then 2
                      else 0 end
             end
             + case when e.lives then 6 else 0 end
             + least(e.participacoes, 3)::int
             - case when e.tem_reembolso and coalesce(co.compras, 0) = 0 then 40
                    when e.tem_reembolso then 10
                    else 0 end
           ))::int as pontos
    from base b
    left join comp co on co.lead_fk = b.lead_id
    join extras e on e.lead_id = b.lead_id
  ),
  final as (
    select c.*,
      case
        when c.tem_reembolso and c.compras = 0 then 'tratar_reembolso'
        when c.tem_formacao and not c.tem_topo then 'alumni_black_acomp'
        when c.tem_formacao and c.tem_topo     then 'vip_relacionamento'
        when c.compras > 0 and c.dias_compra <= 30 then 'formacao_janela_quente'
        when c.compras > 0 and c.dias_compra <= 90 then 'formacao_segunda_chamada'
        when c.compras > 0 then 'reativar_esteira'
        when c.lives then 'desafio_lives'
        when c.dias_entrada <= 90 then 'desafio_novos'
        else 'aquecer_primeiro'
      end as oferta,
      case when c.compras > 0 then
        'Comprou ' || c.compras || 'x · R$ ' || round(c.gasto) ||
        ' · última há ' || c.dias_compra || ' d' ||
        case when c.lives then ' · Lives' else '' end ||
        case when c.tem_reembolso then ' · teve reembolso' else '' end
      else
        'Sem compra · na base há ' || c.dias_entrada || ' d' ||
        case when c.lives then ' · Lives' else '' end ||
        case when c.tem_reembolso then ' · reembolso' else '' end
      end as motivo
    from calc c
  )
  insert into public.lead_venda as lv
    (lead_fk, pontos_venda, proxima_oferta, motivo, ultima_compra,
     compras, gasto_total, alcancavel, calculado_em)
  select lead_id, pontos, oferta, motivo, ultima::date,
         compras, gasto, alcancavel, now()
  from final
  on conflict (lead_fk) do update set
    pontos_venda   = excluded.pontos_venda,
    proxima_oferta = excluded.proxima_oferta,
    motivo         = excluded.motivo,
    ultima_compra  = excluded.ultima_compra,
    compras        = excluded.compras,
    gasto_total    = excluded.gasto_total,
    alcancavel     = excluded.alcancavel,
    calculado_em   = now();

  get diagnostics v_qtd = row_count;

  if p_lead is null then
    -- recálculo completo: recomputa os cortes de percentil e as faixas
    select round(percentile_cont(0.95) within group (order by pontos_venda))::int,
           round(percentile_cont(0.85) within group (order by pontos_venda))::int,
           round(percentile_cont(0.55) within group (order by pontos_venda))::int
      into v_c1, v_c2, v_c3
    from public.lead_venda where alcancavel;

    v_c1 := coalesce(v_c1, 60); v_c2 := coalesce(v_c2, 45); v_c3 := coalesce(v_c3, 20);

    insert into public.venda_cortes (nome, corte) values
      ('prontissimo', v_c1), ('pronto', v_c2), ('aquecendo', v_c3)
    on conflict (nome) do update set corte = excluded.corte;

    update public.lead_venda set faixa =
      case when pontos_venda >= v_c1 then 'prontissimo'
           when pontos_venda >= v_c2 then 'pronto'
           when pontos_venda >= v_c3 then 'aquecendo'
           else 'frio' end
    where faixa is distinct from
      case when pontos_venda >= v_c1 then 'prontissimo'
           when pontos_venda >= v_c2 then 'pronto'
           when pontos_venda >= v_c3 then 'aquecendo'
           else 'frio' end;
  else
    -- recálculo pontual: usa os cortes gravados (ou uma régua de
    -- segurança se o completo nunca rodou)
    select coalesce((select corte from public.venda_cortes where nome = 'prontissimo'), 60),
           coalesce((select corte from public.venda_cortes where nome = 'pronto'), 45),
           coalesce((select corte from public.venda_cortes where nome = 'aquecendo'), 20)
      into v_c1, v_c2, v_c3;

    update public.lead_venda set faixa =
      case when pontos_venda >= v_c1 then 'prontissimo'
           when pontos_venda >= v_c2 then 'pronto'
           when pontos_venda >= v_c3 then 'aquecendo'
           else 'frio' end
    where lead_fk = p_lead;
  end if;

  return v_qtd;
end $$;

revoke execute on function public.recalcular_pontuacao_venda(uuid) from public, anon;
grant execute on function public.recalcular_pontuacao_venda(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 3. compra mudou → a foto de venda daquela pessoa muda na hora.
-- O erro é engolido de propósito: score atrasado se conserta às 03:44;
-- venda que não entra porque o score quebrou não se conserta sozinha.
-- ------------------------------------------------------------------
create or replace function public.tg_venda_recalcula()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.recalcular_pontuacao_venda(new.lead_fk);
  exception when others then
    raise warning 'recalculo de venda falhou para %: %', new.lead_fk, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_venda_recalcula on public.tabela_4_alunos;
create trigger trg_venda_recalcula
  after insert or update of status, valor, nome_produto on public.tabela_4_alunos
  for each row execute function public.tg_venda_recalcula();

-- ------------------------------------------------------------------
-- 4. leituras do painel
-- ------------------------------------------------------------------
create or replace function public.rel_vendas_jogadas()
returns table (oferta text, leads bigint)
language sql stable security definer set search_path = public as $$
  select proxima_oferta, count(*)
  from public.lead_venda
  where alcancavel
  group by 1
$$;

revoke execute on function public.rel_vendas_jogadas() from public, anon;
grant execute on function public.rel_vendas_jogadas() to authenticated, service_role;

create or replace function public.rel_melhores_leads(p_oferta text default null, p_limite int default 50)
returns table (lead_id uuid, nome text, email text, whatsapp text, pontos_venda int,
               faixa text, proxima_oferta text, motivo text, gasto_total numeric)
language sql stable security definer set search_path = public as $$
  select l.lead_id, l.nome, l.email, l.whatsapp, v.pontos_venda,
         v.faixa, v.proxima_oferta, v.motivo, v.gasto_total
  from public.lead_venda v
  join public.tabela_1_leads l on l.lead_id = v.lead_fk
  where v.alcancavel
    and (p_oferta is null or p_oferta = '' or v.proxima_oferta = p_oferta)
  order by v.pontos_venda desc, v.ultima_compra desc nulls last
  limit greatest(1, least(coalesce(p_limite, 50), 200))
$$;

revoke execute on function public.rel_melhores_leads(text, int) from public, anon;
grant execute on function public.rel_melhores_leads(text, int) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 5. segmentos entendem o eixo de venda. Versão viva (= motor_v3_3)
-- + quatro acréscimos: `comprou` com `dias`, `pontuacao_venda`,
-- `proxima_oferta` e `alcancavel`. Todo o resto permanece byte a byte.
-- ------------------------------------------------------------------
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

      -- ---- compras ----
      -- Sempre só o que está 'aprovada'. Contar reembolso como compra
      -- colocaria quem pediu o dinheiro de volta no segmento de
      -- compradores — e ele receberia a campanha de quem ficou.
      -- `dias` (opcional) limita à compra dos últimos N dias — é o que
      -- expressa "janela quente" num segmento.
      when 'comprou' then
        v_pred := format(
          'exists (select 1 from public.tabela_4_alunos c where c.lead_fk = l.lead_id '
          'and c.status = ''aprovada''%s%s)',
          case when coalesce(v_cond->>'produto','') <> ''
               then format(' and c.nome_produto ilike %L', '%' || (v_cond->>'produto') || '%')
               else '' end,
          case when coalesce(v_cond->>'dias','') <> ''
               then format(' and coalesce(c.data_compra, c.created_at) > now() - make_interval(days => %s)',
                           (v_cond->>'dias')::int)
               else '' end);
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;

      when 'qtd_compras' then
        v_pred := format(
          '(select coalesce(compras, 0) from public.compras_por_lead cp where cp.lead_fk = l.lead_id) %s %s',
          case when coalesce(v_cond->>'operador','maior') = 'menor' then '<=' else '>=' end,
          coalesce((v_cond->>'valor')::int, 1));

      when 'total_gasto' then
        v_pred := format(
          '(select coalesce(total_gasto, 0) from public.compras_por_lead cp where cp.lead_fk = l.lead_id) %s %s',
          case when coalesce(v_cond->>'operador','maior') = 'menor' then '<=' else '>=' end,
          coalesce((v_cond->>'valor')::numeric, 0));

      when 'pediu_reembolso' then
        v_pred := 'exists (select 1 from public.tabela_4_alunos c where c.lead_fk = l.lead_id '
                  'and c.status in (''reembolsada'', ''chargeback''))';
        if not coalesce((v_cond->>'tem')::boolean, true) then v_pred := 'not ' || v_pred; end if;

      when 'pontuacao' then
        v_pred := format(
          '(select coalesce(p.pontos, 0) from public.lead_pontuacao p where p.lead_fk = l.lead_id) %s %s',
          case when coalesce(v_cond->>'operador', 'maior') = 'menor' then '<=' else '>=' end,
          coalesce((v_cond->>'valor')::int, 0));

      -- ---- eixo de venda ----
      when 'pontuacao_venda' then
        v_pred := format(
          '(select coalesce(v.pontos_venda, 0) from public.lead_venda v where v.lead_fk = l.lead_id) %s %s',
          case when coalesce(v_cond->>'operador', 'maior') = 'menor' then '<=' else '>=' end,
          coalesce((v_cond->>'valor')::int, 0));

      when 'proxima_oferta' then
        v_pred := format(
          'exists (select 1 from public.lead_venda v where v.lead_fk = l.lead_id and v.proxima_oferta = %L)',
          coalesce(v_cond->>'valor',''));

      -- alcançável = e-mail válido + ativo em alguma lista + fora da
      -- supressão. É o mesmo filtro do painel "Prontos pra comprar";
      -- com ele o segmento da jogada conta IGUAL ao painel.
      when 'alcancavel' then
        v_pred := 'exists (select 1 from public.lead_venda v where v.lead_fk = l.lead_id and v.alcancavel)';
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

-- ------------------------------------------------------------------
-- 6. recalcula toda madrugada, depois do eixo de engajamento (03:32)
-- ------------------------------------------------------------------
select cron.schedule('pontuacao-venda-diaria', '44 3 * * *',
                     'select public.recalcular_pontuacao_venda()')
where not exists (select 1 from cron.job where jobname = 'pontuacao-venda-diaria');

commit;

-- ------------------------------------------------------------------
-- primeira carga + conferência
-- ------------------------------------------------------------------
select public.recalcular_pontuacao_venda() as leads_calculados;

select faixa, count(*) as leads,
       count(*) filter (where alcancavel) as alcancaveis
from public.lead_venda group by 1 order by min(pontos_venda) desc;

select proxima_oferta, count(*) as leads
from public.lead_venda where alcancavel
group by 1 order by 2 desc;

select p.pontos_venda, p.faixa, p.proxima_oferta, p.motivo
from public.lead_venda p where p.alcancavel
order by p.pontos_venda desc limit 5;

select public.contar_segmento(
  '{"op":"and","condicoes":[{"campo":"proxima_oferta","valor":"formacao_janela_quente"},{"campo":"nao_suprimido"}]}'::jsonb)
  as segmento_janela_quente;

select (select count(*) from public.tabela_1_leads) as leads_na_base,
       (select count(*) from public.lead_venda)     as leads_com_venda;
