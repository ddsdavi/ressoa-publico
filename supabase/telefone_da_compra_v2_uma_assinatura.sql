-- =====================================================================
-- UMA ASSINATURA SÓ, E O MAPA DIZENDO DE QUE PRODUTO FALA
--
-- Ao ganhar o produto opcional, manychat_aplicar passou a existir em
-- duas formas (3 e 4 parâmetros). Duas assinaturas da mesma função
-- convivendo já custaram três dias de compras mudas neste projeto: o
-- PostgREST devolve PGRST203 e quem chama engole o erro (armadilha 38).
-- A antiga sai; quem chamava com três argumentos cai na nova, porque o
-- quarto tem valor padrão.
--
-- E o mapa de produtos passa a dizer de qual produto está falando quando
-- marca alguém no ManyChat — é o que faz a mensagem daquele produto ir
-- para o telefone daquela compra.
-- =====================================================================
begin;

drop function if exists public.manychat_aplicar(uuid, text, boolean);

do $$
declare v_qtd int;
begin
  select count(*) into v_qtd from pg_proc
   where proname = 'manychat_aplicar' and pronamespace = 'public'::regnamespace;
  if v_qtd <> 1 then
    raise exception 'manychat_aplicar tem % assinaturas; deveria ter 1', v_qtd;
  end if;
end $$;

-- ------------------------------------------------------------------
-- o mapa de produtos: agora informa o produto ao marcar no ManyChat
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

    -- ---- ManyChat ----
    -- Disparar e esquecer: a resposta do ManyChat não muda nada do que já
    -- foi gravado aqui, e travar a venda esperando uma API de fora seria
    -- trocar um problema pequeno por um grande.
    --
    -- O produto vai junto: quem tem mais de um celular recebe o WhatsApp
    -- deste produto no número com que comprou ESTE produto.
    if coalesce(m.tag_manychat, '') <> '' then
      perform public.manychat_aplicar(p_lead, m.tag_manychat, true, p_produto);
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
        perform public.manychat_aplicar(p_lead, v_many_turma, true, p_produto);
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

do $$
declare v_qtd int;
begin
  select count(*) into v_qtd from pg_proc
   where proname = 'aplicar_mapa_produto' and pronamespace = 'public'::regnamespace;
  if v_qtd <> 1 then
    raise exception 'aplicar_mapa_produto tem % assinaturas; deveria ter 1', v_qtd;
  end if;
end $$;

commit;
