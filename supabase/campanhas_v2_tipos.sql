-- =====================================================================
-- TIPOS DE CAMPANHA + TESTE A/B
--
-- Até aqui toda campanha era "manda uma mensagem pronta para uma lista".
-- Agora a campanha tem tipo, e o e-mail é escrito dentro do próprio fluxo
-- em vez de ser escolhido de uma gaveta.
--
-- O teste A/B é o único tipo que exige motor novo. Os demais já existem:
-- automação e autoresposta são a mesma máquina de automação (autoresposta
-- é uma automação com gatilho "inscreveu-se na lista"), e data comemorativa
-- vira gatilho de automação também.
-- =====================================================================
begin;

alter table public.campanhas
  add column if not exists tipo text not null default 'padrao',
  add column if not exists mensagem_b_fk uuid references public.mensagens(mensagem_id),
  add column if not exists percentual_teste int default 100,
  add column if not exists vencedor text,
  add column if not exists monitorar_resposta boolean not null default false,
  add column if not exists arquivo_publico boolean not null default true,
  add column if not exists utm jsonb;

alter table public.campanhas drop constraint if exists campanhas_tipo_check;
alter table public.campanhas add constraint campanhas_tipo_check
  check (tipo in ('padrao', 'ab'));

alter table public.campanhas drop constraint if exists campanhas_percentual_check;
alter table public.campanhas add constraint campanhas_percentual_check
  check (percentual_teste between 10 and 100);

-- o envio precisa saber qual versão foi para cada pessoa
alter table public.envios add column if not exists variante text;

-- ------------------------------------------------------------------
-- disparo, agora ciente do tipo
-- ------------------------------------------------------------------
create or replace function public.disparar_campanha(p_campanha uuid) returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_lead uuid;
  v_def jsonb;
  v_qtd int := 0;
  v_i int := 0;
  v_envio uuid;
  v_msg uuid;
  v_var text;
  v_total int;
  v_teste int;
begin
  perform public.gate_operacao();
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.status not in ('draft','scheduled') then
    return 0;
  end if;
  if v_camp.tipo = 'ab' and v_camp.mensagem_b_fk is null then
    raise exception 'campanha A/B sem a segunda versão';
  end if;

  update public.campanhas set status = 'sending', started_at = now() where campanha_id = p_campanha;

  -- público, resolvido uma vez só
  create temporary table alvo_campanha (lead_fk uuid, n int) on commit drop;
  if v_camp.segmento_fk is not null then
    select definicao into v_def from public.segmentos where segmento_id = v_camp.segmento_fk;
    insert into alvo_campanha (lead_fk, n)
    select l, row_number() over ()
    from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) l;
  else
    insert into alvo_campanha (lead_fk, n)
    select ll.lead_fk, row_number() over ()
    from (select distinct lead_fk from public.lead_listas
          where lista_fk = any(v_camp.lista_ids) and status = 1) ll;
  end if;

  select count(*) into v_total from alvo_campanha;
  -- no A/B, só a fatia de teste recebe agora; o resto espera o vencedor
  v_teste := case when v_camp.tipo = 'ab'
                  then greatest(2, (v_total * coalesce(v_camp.percentual_teste, 100)) / 100)
                  else v_total end;

  for v_lead, v_i in select lead_fk, n from alvo_campanha order by n loop
    if v_camp.tipo = 'ab' then
      if v_i > v_teste then
        continue;                       -- fica para o disparo do vencedor
      end if;
      -- alternado: metade A, metade B, sem sorteio (resultado reproduzível)
      if v_i % 2 = 1 then v_msg := v_camp.mensagem_fk; v_var := 'A';
      else                v_msg := v_camp.mensagem_b_fk; v_var := 'B'; end if;
    else
      v_msg := v_camp.mensagem_fk; v_var := null;
    end if;

    v_envio := public.enfileirar_email(v_lead, v_msg, p_campanha);
    if v_envio is not null then
      if v_var is not null then
        update public.envios set variante = v_var where envio_id = v_envio;
      end if;
      v_qtd := v_qtd + 1;
    end if;
  end loop;

  return v_qtd;
end $$;

-- ------------------------------------------------------------------
-- placar do A/B
-- ------------------------------------------------------------------
create or replace function public.placar_ab(p_campanha uuid) returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_object_agg(variante, dados), '{}'::jsonb)
  from (
    select e.variante,
           jsonb_build_object(
             'enviados', count(*),
             'aberturas', count(distinct ev.lead_fk) filter (where ev.tipo = 'open'),
             'cliques',   count(distinct ev.lead_fk) filter (where ev.tipo = 'click')
           ) as dados
    from public.envios e
    left join public.eventos_email ev on ev.envio_fk = e.envio_id
    where e.campanha_fk = p_campanha and e.variante is not null
    group by e.variante
  ) x;
$$;

-- Manda o restante do público com a versão que ganhou. Só roda depois que
-- alguém olhou o placar e decidiu — não escolhe sozinho: com público
-- pequeno, a diferença costuma ser ruído, e o sistema não tem como saber
-- se o teste já teve tempo de maturar.
create or replace function public.disparar_vencedor(p_campanha uuid, p_vencedor text)
returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_msg uuid;
  v_lead uuid;
  v_qtd int := 0;
begin
  perform public.gate_operacao();
  if p_vencedor not in ('A','B') then raise exception 'vencedor deve ser A ou B'; end if;
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.tipo <> 'ab' then return 0; end if;
  if v_camp.vencedor is not null then return 0; end if;   -- já foi

  v_msg := case p_vencedor when 'A' then v_camp.mensagem_fk else v_camp.mensagem_b_fk end;

  for v_lead in
    select distinct ll.lead_fk from public.lead_listas ll
    where ll.lista_fk = any(v_camp.lista_ids) and ll.status = 1
      and not exists (select 1 from public.envios e
                      where e.campanha_fk = p_campanha and e.lead_fk = ll.lead_fk)
  loop
    if public.enfileirar_email(v_lead, v_msg, p_campanha) is not null then
      v_qtd := v_qtd + 1;
    end if;
  end loop;

  update public.campanhas set vencedor = p_vencedor where campanha_id = p_campanha;
  return v_qtd;
end $$;

grant execute on function public.placar_ab(uuid) to authenticated;
grant execute on function public.disparar_vencedor(uuid, text) to authenticated;

commit;

select (select count(*) from information_schema.columns
        where table_name='campanhas' and column_name in
        ('tipo','mensagem_b_fk','percentual_teste','vencedor','monitorar_resposta',
         'arquivo_publico','utm'))                                as colunas_novas,
       (select count(*) from information_schema.columns
        where table_name='envios' and column_name='variante')     as variante_no_envio,
       (select count(*) from public.campanhas where status = 'sending') as campanhas_disparando;
