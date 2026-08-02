-- =====================================================================
-- REMOÇÃO DO RSS
--
-- Construí isso sem que fosse pedido. O Davi disse que nunca usou, não sabe
-- do que se trata e não quer usar — então sai inteiro, não só da tela.
-- Funcionalidade que ninguém usa não é neutra: ocupa espaço no menu, aparece
-- na lista de gatilhos, e um dia alguém liga sem entender e fica com um
-- agendamento batendo num blog de hora em hora.
--
-- Sai sem perda: nenhuma fonte chegou a ser cadastrada e nenhum evento
-- rss_novo_item foi gerado. A verificação disso está no fim do arquivo — se
-- houvesse dado, este arquivo falharia antes de apagar qualquer coisa.
--
-- O que NÃO sai: o contexto do evento (%EVENTO.chave%), que nasceu junto no
-- mesmo arquivo mas é o que faz o e-mail de carrinho abandonado citar o
-- produto. Isso fica.
-- =====================================================================

-- trava de segurança: só apaga se estiver mesmo vazio
do $$
declare
  v_fontes int;
  v_eventos int;
begin
  select count(*) into v_fontes from public.rss_fontes;
  select count(*) into v_eventos from public.eventos_sistema where tipo = 'rss_novo_item';
  if v_fontes > 0 or v_eventos > 0 then
    raise exception 'não está vazio: % fonte(s) e % evento(s). Confira antes de apagar.',
      v_fontes, v_eventos;
  end if;
end $$;

select cron.unschedule('rss-verificar')
where exists (select 1 from cron.job where jobname = 'rss-verificar');

begin;

drop function if exists public.rss_verificar();
drop function if exists public.rss_registrar_item(int, text, text, text, text, text);
drop table if exists public.rss_fontes;

commit;

select (select count(*) from cron.job where jobname = 'rss-verificar')          as agendamento,
       (select count(*) from information_schema.tables
        where table_schema='public' and table_name='rss_fontes')                as tabela,
       (select count(*) from pg_proc where proname like 'rss\_%')               as funcoes,
       -- o que tinha que ficar:
       (select count(*) from information_schema.columns
        where table_name='automacao_execucoes' and column_name='contexto')      as contexto_intacto,
       public.personalizar('deixou %EVENTO.produto% para trás', null,
                           '{"produto":"o Desafio"}'::jsonb)                    as prova_do_contexto;
