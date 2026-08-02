-- =====================================================================
-- "PRODUTOS QUE JÁ VENDERAM" DEVE LISTAR SÓ QUEM VENDEU
--
-- A tela de Vendas mostrava um aviso pedindo para configurar um "produto
-- sem nome" com 6 vendas. Não é produto e não são vendas: são os seis
-- eventos de teste que a Hotmart manda quando alguém aperta o botão de
-- testar o webhook — acesso ao clube, módulo concluído, troca de plano,
-- cancelamento de assinatura, data de cobrança, entrega do pedido.
--
-- Todos chegaram no mesmo minuto, todos marcados como "ignorado", e nenhum
-- deles é compra. A função listava qualquer evento com nome de produto
-- preenchido, sem olhar de que tipo era.
--
-- O estrago é pequeno mas corrói: um aviso vermelho pedindo uma ação que
-- não faz sentido ensina a ignorar avisos vermelhos.
-- =====================================================================
begin;

create or replace function public.hotmart_produtos_vistos()
returns table (
  produto text, ucode text, eventos bigint,
  primeira timestamptz, ultima timestamptz, mapeado boolean)
language sql security definer stable set search_path = public as $$
  select e.produto,
         max(e.corpo #>> '{data,product,ucode}') as ucode,
         count(*),
         min(e.recebido_em),
         max(e.recebido_em),
         exists (select 1 from public.hotmart_produtos m
                 where m.ativo
                   and ((m.ucode is not null and m.ucode = max(e.corpo #>> '{data,product,ucode}'))
                        or (coalesce(m.padrao_nome,'') <> '' and e.produto ilike '%' || m.padrao_nome || '%')))
  from public.hotmart_eventos e
  where coalesce(e.produto, '') <> ''
    -- só o que é compra. Clube, assinatura e entrega não criam comprador,
    -- e pedir regra para eles é pedir uma ação sem efeito.
    and e.evento in (
      'PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_BILLET_PRINTED',
      'PURCHASE_PROTEST', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK',
      'PURCHASE_DELAYED', 'PURCHASE_EXPIRED', 'PURCHASE_CANCELED',
      'PURCHASE_OUT_OF_SHOPPING_CART')
  group by e.produto
  order by 3 desc
$$;

grant execute on function public.hotmart_produtos_vistos() to authenticated;

commit;

select produto, eventos, mapeado from public.hotmart_produtos_vistos() order by eventos desc;
