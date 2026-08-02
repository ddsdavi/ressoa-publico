-- =====================================================================
-- HOTMART — receber os eventos direto, sem passar pelo n8n.
--
-- Três peças que faltavam para isso ser confiável:
--
--   1. REGISTRO DO EVENTO CRU. Webhook de venda é dinheiro. Se der erro
--      no meio, o corpo original tem que estar guardado para reprocessar
--      — a Hotmart não reenvia para sempre. Guardar o cru também é a
--      única forma de descobrir por que algo não entrou.
--
--   2. MAPA DE PRODUTOS. É o que faz "comprou o Desafio" virar
--      automaticamente "entra na lista de compradores do Desafio e ganha
--      a tag". Sem isso, cada produto novo precisaria de código.
--
--   3. REPROCESSAMENTO. Se o mapa estava errado quando a venda entrou,
--      dá para rodar de novo em cima do que foi guardado.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. tudo que a Hotmart mandar fica guardado
-- ------------------------------------------------------------------
create table if not exists public.hotmart_eventos (
  evento_id    uuid primary key default gen_random_uuid(),
  evento       text,
  transacao    text,
  email        text,
  produto      text,
  corpo        jsonb not null,
  processado   boolean not null default false,
  erro         text,
  recebido_em  timestamptz not null default now(),
  processado_em timestamptz
);
create index if not exists ix_hot_transacao on public.hotmart_eventos (transacao);
create index if not exists ix_hot_pendente on public.hotmart_eventos (recebido_em desc)
  where not processado;

alter table public.hotmart_eventos enable row level security;
drop policy if exists hot_le on public.hotmart_eventos;
create policy hot_le on public.hotmart_eventos
  for select to authenticated using (public.papel_atual() is not null);
grant select on public.hotmart_eventos to authenticated;

-- ------------------------------------------------------------------
-- 2. o que cada produto faz quando é comprado
-- ------------------------------------------------------------------
create table if not exists public.hotmart_produtos (
  id             int generated always as identity primary key,
  padrao_nome    text not null,        -- casa por PARTE do nome, sem exigir exatidão
  apelido        text,
  lista_fk       int references public.listas(lista_id),
  tag_fk         int references public.tags(tag_id),
  tag_reembolso  int references public.tags(tag_id),
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.hotmart_produtos enable row level security;
drop policy if exists hotp_le on public.hotmart_produtos;
create policy hotp_le on public.hotmart_produtos
  for select to authenticated using (public.papel_atual() is not null);
drop policy if exists hotp_escreve on public.hotmart_produtos;
create policy hotp_escreve on public.hotmart_produtos
  for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');
grant select, insert, update, delete on public.hotmart_produtos to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ------------------------------------------------------------------
-- 3. aplica o mapa: entra na lista, ganha a tag.
-- Reembolso NÃO desfaz a compra: aplica a tag de reembolso e o status já
-- tira a pessoa dos segmentos de comprador. Apagar o histórico seria
-- perder a informação de que ela um dia comprou — que é justamente o que
-- você quer saber ao decidir se convida de novo.
-- ------------------------------------------------------------------
create or replace function public.aplicar_mapa_produto(
  p_lead uuid, p_produto text, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_lista int := null;
  v_tag int := null;
begin
  select * into m from public.hotmart_produtos
  where ativo and p_produto ilike '%' || padrao_nome || '%'
  order by length(padrao_nome) desc   -- o padrão mais específico ganha
  limit 1;

  if not found then
    return jsonb_build_object('mapeado', false);
  end if;

  if p_status = 'aprovada' then
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

  elsif p_status in ('reembolsada', 'chargeback') and m.tag_reembolso is not null then
    insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, m.tag_reembolso)
    on conflict do nothing;
    v_tag := m.tag_reembolso;
  end if;

  return jsonb_build_object('mapeado', true, 'produto', m.apelido,
                            'lista', v_lista, 'tag', v_tag);
end $$;

grant execute on function public.aplicar_mapa_produto(uuid, text, text) to authenticated, anon, service_role;

-- ------------------------------------------------------------------
-- 4. o que ainda não foi processado
-- ------------------------------------------------------------------
create or replace function public.hotmart_pendentes()
returns table (evento_id uuid, evento text, email text, produto text,
               erro text, recebido_em timestamptz)
language sql stable security definer set search_path = public as $$
  select evento_id, evento, email, produto, erro, recebido_em
  from public.hotmart_eventos
  where not processado
  order by recebido_em desc
  limit 200
$$;
grant execute on function public.hotmart_pendentes() to authenticated;

commit;

select (select count(*) from public.hotmart_produtos) as produtos_mapeados,
       (select count(*) from public.hotmart_eventos) as eventos_guardados;
