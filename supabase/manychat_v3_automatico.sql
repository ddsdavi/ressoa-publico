-- =====================================================================
-- MANYCHAT v3 — a pessoa entra lá sozinha
--
-- Até aqui marcar no ManyChat era um passo que alguém tinha que arrastar
-- para dentro de uma automação. Agora o mapa de produtos leva junto a tag
-- do ManyChat: comprou, entra na lista daqui, ganha a tag da turma daqui,
-- e é marcada lá — na mesma transação, sem passo manual.
--
-- Por que no mapa de produtos e não numa automação: a compra já passa por
-- aqui obrigatoriamente. Quem monta uma automação pode esquecer de ligar,
-- e o sintoma seria a pessoa comprar e não receber o WhatsApp — o tipo de
-- falha que só aparece quando o cliente reclama.
-- =====================================================================
begin;

alter table public.hotmart_produtos
  add column if not exists tag_manychat text,          -- tag fixa, ex.: COMPROU_DESAFIO
  add column if not exists tag_manychat_turma boolean not null default false;
                                                       -- também manda a tag da turma

comment on column public.hotmart_produtos.tag_manychat is
  'Tag aplicada no ManyChat quando a compra é aprovada. Vazio = não marca.';
comment on column public.hotmart_produtos.tag_manychat_turma is
  'Se verdadeiro, manda também a tag da turma (a mesma calculada aqui).';

-- ------------------------------------------------------------------
-- o mapa de produtos passa a marcar no ManyChat também
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
  v_turma_nome text := null;
  v_many text := null;
  v_many_turma text := null;
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

    v_turma := public.tag_da_turma(m.tag_turma_padrao, m.turma_dia_semana,
                                   m.turma_hora, m.turma_fuso, p_quando);
    if v_turma is not null then
      insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, v_turma)
      on conflict do nothing;
      select nome into v_turma_nome from public.tags where tag_id = v_turma;
    end if;

    -- ---- e agora o ManyChat ----
    -- Disparar e esquecer: a resposta do ManyChat não muda nada do que já
    -- foi gravado aqui, e travar a venda esperando uma API de fora seria
    -- trocar um problema pequeno por um grande.
    if coalesce(m.tag_manychat, '') <> '' then
      perform public.manychat_aplicar(p_lead, m.tag_manychat, true);
      v_many := m.tag_manychat;
    end if;
    if m.tag_manychat_turma then
      -- A tag de turma NO MANYCHAT pode ter outro formato: lá o ano é de
      -- dois dígitos. Mandar a nossa criaria uma tag paralela que nenhuma
      -- automação de lá escuta — marcada, e nada acontece.
      v_many_turma := public.nome_da_turma(
        coalesce(nullif(m.tag_manychat_turma_padrao, ''), m.tag_turma_padrao),
        m.turma_dia_semana, m.turma_hora, m.turma_fuso, p_quando);
      if v_many_turma is not null then
        perform public.manychat_aplicar(p_lead, v_many_turma, true);
        v_many := case when v_many is null then '' else v_many || ' + ' end || v_many_turma;
      end if;
    end if;

  elsif p_status in ('reembolsada', 'chargeback') and m.tag_reembolso is not null then
    insert into public.lead_tags (lead_fk, tag_fk) values (p_lead, m.tag_reembolso)
    on conflict do nothing;
    v_tag := m.tag_reembolso;
  end if;

  return jsonb_build_object('mapeado', true, 'produto', m.apelido,
                            'lista', v_lista, 'tag', v_tag,
                            'turma', v_turma_nome, 'manychat', v_many);
end $$;

grant execute on function public.aplicar_mapa_produto(uuid, text, text, text, timestamptz)
  to authenticated, anon, service_role;

commit;

select apelido,
       coalesce(tag_manychat, '—')                    as tag_fixa_no_manychat,
       tag_manychat_turma                             as manda_a_turma,
       coalesce(tag_manychat_turma_padrao, '(igual)') as padrao_da_turma_la
from public.hotmart_produtos where ativo order by apelido;
