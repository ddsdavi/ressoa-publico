-- =====================================================================
-- CORREÇÃO — as compras de order bump que a corrida do contato derrubou.
--
-- Order bump e upsell são vendidos no MESMO checkout, e a Hotmart manda um
-- webhook por item: os dois chegam com 1 a 600 milissegundos de diferença,
-- mesmo número de pedido, sufixos C1 e C2. Quando o comprador ainda não
-- estava na base, as duas requisições procuravam o contato, nenhuma achava,
-- as duas tentavam criar, e a segunda esbarrava na chave única do WhatsApp
-- (tabela_1_leads_whatsapp_key). Esse item morria com HTTP 500 antes de
-- gravar a venda. Oito eventos entre 03 e 06/08/2026 ficaram assim.
--
-- O conserto do código está no app/functions/venda: perder a corrida deixa
-- de ser falha e passa a ser "procure de novo, é a mesma pessoa". Este
-- script cuida do que já aconteceu — código novo não volta no tempo.
--
-- Das oito, cinco se resolveram sozinhas (boleto que ninguém pagou continua
-- pendente, que é o certo). TRÊS ficaram erradas: a Hotmart reenviou o aviso
-- de boleto que falhou, ele chegou junto com a aprovação e rebaixou a venda
-- paga para "pendente" — quem pagou saiu da lista de compradores sem que
-- nada denunciasse. As três são do "Curso: energia da sua casa", R$ 44 cada.
--
-- Duas delas nunca entraram na lista nem ganharam a tag do produto.
--
-- Seguro de rodar mais de uma vez: cada passo só age sobre o que ainda está
-- errado.
-- =====================================================================
begin;

-- As datas de aprovação vêm do corpo original de cada PURCHASE_APPROVED
-- guardado em hotmart_eventos (data.purchase.approved_date), não de agora:
-- a venda aconteceu quando aconteceu.
create temporary table _corrigir (
  codigo_transacao text primary key,
  aprovada_em      timestamptz not null
) on commit drop;

insert into _corrigir values
  ('HP2179296554C2', '2026-08-06T05:09:31Z'),
  ('HP0704046678C2', '2026-08-04T14:29:33Z'),
  ('HP2826985484C2', '2026-08-04T08:48:09Z');

-- 1) a venda paga volta a constar como paga.
--    O filtro por 'pendente' é o que torna o script repetível.
update public.tabela_4_alunos a
   set status        = 'aprovada',
       data_compra   = c.aprovada_em,
       evento_origem = 'PURCHASE_APPROVED',
       updated_at    = now()
  from _corrigir c
 where a.codigo_transacao = c.codigo_transacao
   and a.status = 'pendente';

-- 2) a tag de comprador, para quem ficou de fora.
--    Resolvida pelo NOME e não por id fixo: id de tag não é estável entre
--    ambientes, e nome errado aqui marcaria a pessoa na tag de outro produto.
insert into public.lead_tags (lead_fk, tag_fk)
select a.lead_fk, t.tag_id
  from public.tabela_4_alunos a
  join _corrigir c on c.codigo_transacao = a.codigo_transacao
  join public.tags t on t.nome = 'COMPROU_CURSO_ENERGIA_DA_CASA'
 where a.lead_fk is not null
on conflict (lead_fk, tag_fk) do nothing;

-- 3) a lista do produto, idem.
--    source diz de onde veio a inscrição — daqui a três meses ninguém
--    lembra por que estas três entraram fora do fluxo normal.
--
--    subscribed_at é a data da APROVAÇÃO, não a de hoje: é quando a pessoa
--    deveria ter entrado, e é dessa coluna que a pontuação tira o "há
--    quanto tempo este contato se mexe" (pontuacao_v1_1).
insert into public.lead_listas (lead_fk, lista_fk, status, source, subscribed_at)
select a.lead_fk, l.lista_id, 1, 'correcao:order_bump_ago2026', c.aprovada_em
  from public.tabela_4_alunos a
  join _corrigir c on c.codigo_transacao = a.codigo_transacao
  join public.listas l on l.nome = 'CURSO_ENERGIA_DA_CASA'
 where a.lead_fk is not null
on conflict (lead_fk, lista_fk) do nothing;

-- 4) os oito eventos param de aparecer em vermelho na tela de Vendas.
--    O motivo original fica registrado: a linha vira histórico, não some.
update public.hotmart_eventos e
   set situacao  = 'processado',
       processado = true,
       processado_em = coalesce(e.processado_em, now()),
       erro = 'corrida de order bump (contato duplicado) — corrigido em '
              || to_char(now(), 'DD/MM/YYYY') || '. Motivo original: ' || e.erro
 where e.situacao = 'erro'
   and e.erro like '%tabela_1_leads_whatsapp_key%';

commit;

-- ============================ conferência ============================
-- As três têm de sair 'aprovada', com tag e lista.
select a.codigo_transacao,
       a.status,
       a.data_compra,
       exists (select 1 from public.lead_tags lt join public.tags t on t.tag_id = lt.tag_fk
                where lt.lead_fk = a.lead_fk and t.nome = 'COMPROU_CURSO_ENERGIA_DA_CASA') as tem_tag,
       exists (select 1 from public.lead_listas ll join public.listas l on l.lista_id = ll.lista_fk
                where ll.lead_fk = a.lead_fk and l.nome = 'CURSO_ENERGIA_DA_CASA'
                  and ll.status = 1) as tem_lista
  from public.tabela_4_alunos a
 where a.codigo_transacao in ('HP2179296554C2', 'HP0704046678C2', 'HP2826985484C2')
 order by a.codigo_transacao;

-- E não pode sobrar nenhum erro de contato duplicado.
select count(*) as erros_de_contato_duplicado
  from public.hotmart_eventos
 where situacao = 'erro' and erro like '%tabela_1_leads_whatsapp_key%';
