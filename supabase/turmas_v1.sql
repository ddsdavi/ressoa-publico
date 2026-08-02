-- =====================================================================
-- TAG DE TURMA — a tag que muda sozinha a cada nova turma.
--
-- Alguns produtos abrem turma nova em intervalo fixo. Quem compra entra
-- na PRÓXIMA turma, e a tag precisa dizer qual. No caso do desafio:
-- turma nova toda segunda às 7h, e quem compra recebe a tag da segunda
-- seguinte — CASA_H_2026_08_03, depois CASA_H_2026_08_10, e assim por
-- diante.
--
-- Antes isso era feito por automação externa, com a tag escrita à mão a
-- cada semana. Agora é o próprio sistema que calcula, e a tag é criada na
-- hora se ainda não existir.
--
-- Duas decisões que evitam erro:
--
--   1. O cálculo é feito no FUSO configurado, não em UTC. A diferença não
--      é teórica: com a virada às 7h de Brasília, calcular em UTC jogaria
--      todo mundo que comprasse entre 4h e 7h na turma errada.
--
--   2. A turma é calculada a partir da DATA DA COMPRA, não de "agora".
--      Assim dá para reprocessar compras antigas e cada uma cai na turma
--      a que realmente pertenceu.
-- =====================================================================
begin;

alter table public.hotmart_produtos
  add column if not exists tag_turma_padrao text,      -- ex.: CASA_H_{AAAA}_{MM}_{DD}
  add column if not exists turma_dia_semana int,       -- 1 = segunda … 7 = domingo
  add column if not exists turma_hora int default 7,
  add column if not exists turma_fuso text default 'America/Sao_Paulo';

alter table public.hotmart_produtos drop constraint if exists hotmart_produtos_dia_check;
alter table public.hotmart_produtos add constraint hotmart_produtos_dia_check
  check (turma_dia_semana is null or turma_dia_semana between 1 and 7);

-- ------------------------------------------------------------------
-- calcula o nome da tag da turma para um instante
-- ------------------------------------------------------------------
create or replace function public.nome_da_turma(
  p_padrao text, p_dia int, p_hora int, p_fuso text, p_quando timestamptz)
returns text
language plpgsql immutable as $$
declare
  v_local timestamp;
  v_inicio date;   -- início da turma que está aberta neste instante
  v_turma date;    -- a turma que quem compra agora vai pegar
  v_dia int := coalesce(p_dia, 1);
  v_hora int := coalesce(p_hora, 7);
begin
  if coalesce(p_padrao, '') = '' then
    return null;
  end if;

  v_local := p_quando at time zone coalesce(p_fuso, 'America/Sao_Paulo');

  -- desloca o relógio para que a virada caia na meia-noite, e então
  -- trunca na semana. date_trunc('week') sempre devolve segunda-feira.
  v_inicio := (date_trunc('week', v_local - make_interval(hours => v_hora))
               + make_interval(days => v_dia - 1))::date;

  -- se o dia da semana escolhido ainda não chegou nesta semana, a turma
  -- corrente começou na semana passada
  if v_inicio > (v_local - make_interval(hours => v_hora))::date then
    v_inicio := v_inicio - 7;
  end if;

  v_turma := v_inicio + 7;   -- quem compra agora entra na próxima

  return replace(replace(replace(p_padrao,
           '{AAAA}', to_char(v_turma, 'YYYY')),
           '{MM}',   to_char(v_turma, 'MM')),
           '{DD}',   to_char(v_turma, 'DD'));
end $$;

-- ------------------------------------------------------------------
-- devolve o id da tag da turma, criando-a se ainda não existir
-- ------------------------------------------------------------------
create or replace function public.tag_da_turma(
  p_padrao text, p_dia int, p_hora int, p_fuso text, p_quando timestamptz)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_nome text := public.nome_da_turma(p_padrao, p_dia, p_hora, p_fuso, p_quando);
  v_id int;
begin
  if v_nome is null then return null; end if;

  select tag_id into v_id from public.tags where nome = v_nome;
  if v_id is not null then return v_id; end if;

  insert into public.tags (nome, descricao)
  values (v_nome, 'turma criada automaticamente pelo mapa de produtos')
  returning tag_id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------
-- o mapa de produtos passa a aplicar a tag de turma também
-- ------------------------------------------------------------------
create or replace function public.aplicar_mapa_produto(
  p_lead uuid, p_produto text, p_status text,
  p_ucode text default null, p_quando timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_lista int := null;
  v_tag int := null;
  v_turma int := null;
begin
  select * into m from public.hotmart_produtos
  where ativo
    and ((p_ucode is not null and ucode = p_ucode)
         or (coalesce(padrao_nome,'') <> '' and p_produto ilike '%' || padrao_nome || '%'))
  order by (ucode is not null and ucode = p_ucode) desc,
           length(coalesce(padrao_nome,'')) desc
  limit 1;

  if not found then
    return jsonb_build_object('mapeado', false);
  end if;

  if p_status in ('aprovada', 'parcialmente_reembolsada') then
    if m.lista_fk is not null then
      insert into public.lead_listas (lead_fk, lista_fk, status, source)
      values (p_lead, m.lista_fk, 1, 'hotmart')
      on conflict (lead_fk, lista_fk) do update set status = 1, updated_at = now();
      v_lista := m.lista_fk;
    end if;
    if m.tag_fk is not null then
      insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, m.tag_fk)
      on conflict do nothing;
      v_tag := m.tag_fk;
    end if;

    -- a turma, calculada a partir da data da COMPRA
    v_turma := public.tag_da_turma(m.tag_turma_padrao, m.turma_dia_semana,
                                   m.turma_hora, m.turma_fuso, p_quando);
    if v_turma is not null then
      insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, v_turma)
      on conflict do nothing;
    end if;

  elsif p_status in ('reembolsada', 'chargeback') and m.tag_reembolso is not null then
    insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, m.tag_reembolso)
    on conflict do nothing;
    v_tag := m.tag_reembolso;
  end if;

  return jsonb_build_object('mapeado', true, 'produto', m.apelido,
                            'lista', v_lista, 'tag', v_tag,
                            'turma', (select nome from public.tags where tag_id = v_turma));
end $$;

grant execute on function public.nome_da_turma(text, int, int, text, timestamptz) to authenticated;
grant execute on function public.tag_da_turma(text, int, int, text, timestamptz)
  to authenticated, anon, service_role;
grant execute on function public.aplicar_mapa_produto(uuid, text, text, text, timestamptz)
  to authenticated, anon, service_role;

commit;

-- prova: as viradas caem no minuto certo
select to_char(d at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI Dy') as momento,
       public.nome_da_turma('CASA_H_{AAAA}_{MM}_{DD}', 1, 7, 'America/Sao_Paulo', d) as turma
from (values
  (timestamptz '2026-08-02 11:46-03'), (timestamptz '2026-08-03 06:59-03'),
  (timestamptz '2026-08-03 07:00-03'), (timestamptz '2026-08-09 23:59-03'),
  (timestamptz '2026-08-10 07:00-03'), (timestamptz '2026-08-17 07:00-03')
) v(d) order by d;
