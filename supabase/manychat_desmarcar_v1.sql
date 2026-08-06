-- =====================================================================
-- DESMARCAR NO MANYCHAT
--
-- Até aqui o sistema só sabia PÔR tag no ManyChat. Enquanto tudo dá
-- certo, tirar não faz falta; quando alguma coisa marca a pessoa errada,
-- a falta vira um problema que não tem conserto pelo caminho normal —
-- e o lado de lá é o que manda WhatsApp.
--
-- A Edge Function já sabia desmarcar (ação "desmarcar", que chama
-- /subscriber/removeTagByName). O que não existia era a ponta daqui, a
-- que o motor e as correções conseguem chamar.
--
-- Espelha manychat_aplicar de propósito: mesma porta, mesma chave, mesmo
-- log. Quem souber usar uma sabe usar a outra.
--
-- Precisa do id do assinante: o ManyChat remove tag por id, não por
-- telefone. Sem ele, devolve o motivo em vez de fingir que funcionou.
-- =====================================================================
begin;

create or replace function public.manychat_desmarcar(
  p_lead uuid, p_tag text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
  v_lead record;
begin
  if coalesce(public.segredo('manychat_api_key'), '') = '' then
    return 'sem chave do ManyChat configurada';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key';
  end if;

  select email, nome, whatsapp, manychat_id into v_lead
  from public.tabela_1_leads where lead_id = p_lead;
  if not found then return 'lead não encontrado'; end if;

  -- Sem o id do assinante não há o que remover. Isso não é falha: quem
  -- nunca foi marcado lá não tem id guardado aqui.
  if coalesce(v_lead.manychat_id, '') = '' then
    return 'lead sem id do ManyChat — nada a desmarcar';
  end if;

  perform net.http_post(
    url := v_base || '/manychat',
    body := jsonb_build_object(
      'acao', 'desmarcar',
      'lead_id', p_lead, 'manychat_id', v_lead.manychat_id, 'tag', p_tag),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.manychat_desmarcar(uuid, text)
  to authenticated, service_role;

comment on function public.manychat_desmarcar(uuid, text) is
  'Tira uma tag do contato no ManyChat. Par de manychat_aplicar.';

commit;
