-- =====================================================================
-- GESTÃO — mesclar tags, duplicar lista e o cadastro de campos próprios.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. MESCLAR TAGS
--
-- Une várias tags numa só. O detalhe que quebra tudo se for esquecido:
-- automações apontam para tag por ID, no gatilho e nos passos. Apagar a
-- tag sem reapontar deixa a automação viva com um alvo que não existe —
-- ela para de disparar e ninguém percebe. Por isso o reaponte acontece
-- ANTES do delete, na mesma transação.
-- ------------------------------------------------------------------
create or replace function public.mesclar_tags(p_origens int[], p_destino int)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

  -- automações que usavam as origens passam a usar o destino
  update public.automacoes
  set gatilho = jsonb_set(gatilho, '{tag_id}', to_jsonb(p_destino))
  where gatilho->>'tipo' = 'tag_adicionada'
    and (gatilho->>'tag_id')::int = any(v_origens);
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
-- 2. DUPLICAR LISTA
-- Com ou sem os contatos. Sem contatos é o caso comum: repetir a
-- estrutura de um lançamento para o próximo.
-- ------------------------------------------------------------------
create or replace function public.duplicar_lista(
  p_lista int, p_nome text, p_com_contatos boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare v_nova int;
begin
  insert into public.listas (nome, descricao)
  select coalesce(nullif(p_nome, ''), l.nome || ' (cópia)'), l.descricao
  from public.listas l where l.lista_id = p_lista
  returning lista_id into v_nova;

  if v_nova is null then
    raise exception 'lista de origem não encontrada';
  end if;

  if p_com_contatos then
    -- só quem está ativo: copiar descadastrado é reinscrever quem pediu
    -- para sair, o que não pode acontecer nunca
    insert into public.lead_listas (lead_fk, lista_fk, status, source, subscribed_at)
    select ll.lead_fk, v_nova, 1, 'copia_lista', now()
    from public.lead_listas ll
    where ll.lista_fk = p_lista and ll.status = 1
    on conflict (lead_fk, lista_fk) do nothing;
  end if;

  return v_nova;
end $$;

-- ------------------------------------------------------------------
-- 3. CAMPOS PRÓPRIOS
-- Os valores já existem em lead_atributos.dados (um JSON por lead). O que
-- faltava era o cadastro: nome legível, tipo, grupo e a variável usada nos
-- e-mails. Sem isso a coluna aparece como "16LC-UTM-SOURCE" e ninguém sabe
-- o que é nem como usar.
-- ------------------------------------------------------------------
create table if not exists public.campos_personalizados (
  campo_id   int generated always as identity primary key,
  chave      text not null unique,          -- a chave dentro do JSON
  rotulo     text not null,                 -- o nome que a pessoa lê
  tipo       text not null default 'texto'
             check (tipo in ('texto', 'texto_longo', 'numero', 'data', 'lista_opcoes', 'oculto')),
  grupo      text not null default 'Geral',
  opcoes     text[],                        -- só para lista_opcoes
  ordem      int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ix_campos_grupo on public.campos_personalizados (grupo, ordem);

alter table public.campos_personalizados enable row level security;

drop policy if exists campos_leitura on public.campos_personalizados;
create policy campos_leitura on public.campos_personalizados
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists campos_escrita on public.campos_personalizados;
create policy campos_escrita on public.campos_personalizados
  for all to authenticated
  using (public.papel_atual() in ('admin', 'terapeuta'))
  with check (public.papel_atual() in ('admin', 'terapeuta'));

grant select, insert, update, delete on public.campos_personalizados to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- descobre as chaves que existem nos dados e diz quantos leads usam cada uma
create or replace function public.campos_em_uso()
returns table (chave text, leads bigint, cadastrado boolean, exemplo text)
language sql stable security definer set search_path = public as $$
  select j.key,
         count(*),
         exists (select 1 from public.campos_personalizados c where c.chave = j.key),
         (array_agg(j.value #>> '{}' order by length(j.value #>> '{}') desc))[1]
  from public.lead_atributos la,
       lateral jsonb_each(la.dados) j
  where coalesce(j.value #>> '{}', '') <> ''
  group by j.key
  order by 2 desc
$$;

grant execute on function public.mesclar_tags(int[], int) to authenticated;
grant execute on function public.duplicar_lista(int, text, boolean) to authenticated;
grant execute on function public.campos_em_uso() to authenticated;

commit;

-- cadastra automaticamente os campos que já existem nos dados, agrupados
-- pelo prefixo antes do primeiro hífen (16LC-UTM-SOURCE -> grupo 16LC)
insert into public.campos_personalizados (chave, rotulo, tipo, grupo)
select c.chave,
       initcap(replace(replace(c.chave, '-', ' '), '_', ' ')),
       case when c.chave ilike '%utm%' or c.chave ilike '%id%' then 'oculto' else 'texto' end,
       case when position('-' in c.chave) > 1 then split_part(c.chave, '-', 1) else 'Geral' end
from public.campos_em_uso() c
where not c.cadastrado
on conflict (chave) do nothing;

select count(*) as campos_cadastrados,
       count(distinct grupo) as grupos
from public.campos_personalizados;
