-- Ajustes vindos da documentação oficial do webhook 2.0.0 da Hotmart.
--
--   1. purchase.status distingue REEMBOLSO PARCIAL, que não é reembolso
--      (a pessoa ficou com parte) nem venda cheia. Faltava esse status.
--   2. product.ucode é o identificador ESTÁVEL do produto. Nome de
--      produto muda; ucode não. O mapa passa a casar pelos dois.
--   3. O evento tem id único — guardar evita processar duas vezes se a
--      Hotmart reenviar.
begin;

alter table public.tabela_4_alunos drop constraint if exists tabela_4_alunos_status_check;
alter table public.tabela_4_alunos add constraint tabela_4_alunos_status_check
  check (status in ('aprovada','pendente','reembolsada','parcialmente_reembolsada',
                    'chargeback','cancelada','expirada'));

alter table public.hotmart_eventos add column if not exists hotmart_id text;
create unique index if not exists ux_hotmart_id on public.hotmart_eventos (hotmart_id)
  where hotmart_id is not null;

alter table public.hotmart_produtos add column if not exists ucode text;
alter table public.hotmart_produtos alter column padrao_nome drop not null;

create or replace function public.aplicar_mapa_produto(
  p_lead uuid, p_produto text, p_status text, p_ucode text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_lista int := null;
  v_tag int := null;
begin
  -- ucode primeiro: é o identificador que não muda quando o produto é
  -- renomeado. O nome fica como rede de segurança.
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

  elsif p_status in ('reembolsada', 'chargeback') and m.tag_reembolso is not null then
    insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, m.tag_reembolso)
    on conflict do nothing;
    v_tag := m.tag_reembolso;
  end if;

  return jsonb_build_object('mapeado', true, 'produto', m.apelido,
                            'lista', v_lista, 'tag', v_tag);
end $$;

grant execute on function public.aplicar_mapa_produto(uuid, text, text, text)
  to authenticated, anon, service_role;

commit;

select 'ok' as pronto;
