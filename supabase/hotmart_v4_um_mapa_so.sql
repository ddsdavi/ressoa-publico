-- =====================================================================
-- HOTMART v4 — um mapa só: morre a ambiguidade que calou a esteira
--
-- Desde 02/08/2026 à tarde toda compra aprovada era gravada, mas não
-- entrava em lista, não ganhava tag de turma e não marcava ManyChat.
-- O corpo das funções estava certo. O problema: TRÊS versões de
-- aplicar_mapa_produto conviviam no banco (3, 4 e 5 parâmetros), porque
-- "create or replace" com assinatura diferente não substitui — cria uma
-- SOBRECARGA ao lado da antiga.
--
-- A Edge Function `venda` chama via PostgREST com 4 argumentos nomeados
-- (p_lead, p_produto, p_status, p_ucode). Esse conjunto serve tanto à
-- versão de 4 parâmetros quanto à de 5 (p_quando tem default) — e o
-- PostgREST, sem critério para escolher, responde 300 PGRST203 em vez de
-- executar qualquer uma. Em SQL puro a dupla também quebra: a chamada com
-- 4 argumentos posicionais de reprocessar_evento_hotmart vira
-- "function ... is not unique" (42725).
--
-- Fica somente a versão completa, de 5 parâmetros (turmas_v1, corpo de
-- manychat_v3): as outras duas eram história. Quem chama com menos
-- argumentos cai nos defaults dela.
-- =====================================================================
begin;

drop function if exists public.aplicar_mapa_produto(uuid, text, text);
drop function if exists public.aplicar_mapa_produto(uuid, text, text, text);

-- Trava: se um dia nascer uma segunda assinatura, este arquivo derruba a
-- instalação aqui — quebrar alto é melhor do que calar a esteira de novo.
do $$
declare v_qtd int;
begin
  select count(*) into v_qtd
  from pg_proc
  where proname = 'aplicar_mapa_produto'
    and pronamespace = 'public'::regnamespace;
  if v_qtd <> 1 then
    raise exception
      'aplicar_mapa_produto tem % assinaturas; deveria ter exatamente 1', v_qtd;
  end if;
end $$;

commit;

-- prova mecânica: a única assinatura viva é a completa
select p.oid::regprocedure::text as assinatura_unica
from pg_proc p
where p.proname = 'aplicar_mapa_produto'
  and p.pronamespace = 'public'::regnamespace;
