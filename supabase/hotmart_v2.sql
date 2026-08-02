-- =====================================================================
-- HOTMART v2 — o teste real revelou duas coisas.
--
-- 1. A conta manda MUITO mais que eventos de compra: acesso à área de
--    membros, módulo concluído, envio de produto físico, cancelamento de
--    assinatura, troca de plano. Eles chegavam marcados como ERRO, o que
--    é mentira: não são falha, são evento que este endereço não trata.
--    Erro vermelho na tela para coisa normal treina a pessoa a ignorar
--    erro — e aí o erro de verdade passa batido.
--
-- 2. CANCELAMENTO DE ASSINATURA é valioso e estava sendo descartado. Se
--    a a dona da conta tiver produto recorrente, saber quem cancelou vale mais
--    que quase qualquer outro sinal.
-- =====================================================================
begin;

alter table public.hotmart_eventos
  add column if not exists situacao text not null default 'pendente';

alter table public.hotmart_eventos drop constraint if exists hotmart_eventos_situacao_check;
alter table public.hotmart_eventos add constraint hotmart_eventos_situacao_check
  check (situacao in ('pendente','processado','ignorado','erro'));

-- corrige o que já entrou: o que falhou por não ser evento de compra
-- passa a constar como ignorado
update public.hotmart_eventos
set situacao = case
      when processado then 'processado'
      when erro = 'sem e-mail nem telefone do comprador'
           and evento not like 'PURCHASE%' then 'ignorado'
      when erro is not null then 'erro'
      else 'pendente' end,
    erro = case
      when not processado and evento not like 'PURCHASE%'
      then 'evento fora do escopo de compra — registrado para consulta'
      else erro end;

alter table public.hotmart_produtos
  add column if not exists tag_cancelamento int references public.tags(tag_id);

-- ------------------------------------------------------------------
-- cancelamento de assinatura: acha a pessoa e marca
-- ------------------------------------------------------------------
create or replace function public.hotmart_cancelou_assinatura(
  p_email text, p_produto text, p_ucode text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  m record;
begin
  select lead_id into v_lead from public.tabela_1_leads
  where email = lower(trim(p_email)) limit 1;
  if v_lead is null then
    return jsonb_build_object('erro', 'assinante não está na base');
  end if;

  select * into m from public.hotmart_produtos
  where ativo
    and ((p_ucode is not null and ucode = p_ucode)
         or (coalesce(padrao_nome,'') <> '' and p_produto ilike '%' || padrao_nome || '%'))
  limit 1;

  if found and m.tag_cancelamento is not null then
    insert into public.lead_tags (lead_fk, tag_fk) values (v_lead, m.tag_cancelamento)
    on conflict do nothing;
    return jsonb_build_object('lead', v_lead, 'tag', m.tag_cancelamento);
  end if;

  return jsonb_build_object('lead', v_lead, 'tag', null,
                            'nota', 'produto sem tag de cancelamento configurada');
end $$;

grant execute on function public.hotmart_cancelou_assinatura(text, text, text)
  to authenticated, anon, service_role;

-- ------------------------------------------------------------------
-- a tela passa a contar por situação
-- ------------------------------------------------------------------
create or replace function public.hotmart_resumo()
returns table (situacao text, eventos bigint, tipos text)
language sql stable security definer set search_path = public as $$
  select situacao, count(*), string_agg(distinct coalesce(evento,'?'), ', ')
  from public.hotmart_eventos
  group by situacao
  order by case situacao when 'erro' then 1 when 'pendente' then 2
                         when 'processado' then 3 else 4 end
$$;
grant execute on function public.hotmart_resumo() to authenticated;

commit;

select * from public.hotmart_resumo();
