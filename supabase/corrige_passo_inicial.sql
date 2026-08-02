-- =====================================================================
-- CORREÇÃO — nenhuma automação disparada por gatilho jamais executou
-- um passo sequer.
--
-- automacao_execucoes.passo_atual tinha DEFAULT 0. Os passos são
-- numerados a partir de 1. Então toda execução criada por gatilho
-- procurava o passo 0, não encontrava, e se marcava "concluída" na hora
-- — sem enviar e-mail, sem aplicar tag, sem nada.
--
-- E o pior: terminava com status de sucesso. Nenhum erro, nenhum alerta.
-- O relatório mostraria execuções concluídas e ninguém desconfiaria.
--
-- Passou despercebido até agora porque o sistema estava em modo simulado
-- e nenhuma automação tinha sido acionada de verdade.
-- =====================================================================
begin;

alter table public.automacao_execucoes alter column passo_atual set default 1;

-- execuções que nasceram no passo 0 e "concluíram" sem fazer nada: se a
-- automação tem passos e nenhum e-mail foi enfileirado por ela, é vítima
-- deste bug. Voltam para a fila no passo 1.
update public.automacao_execucoes ax
set passo_atual = 1, status = 'em_andamento', finalizado_em = null, agendado_para = now()
where ax.passo_atual = 0
  and ax.status = 'concluida'
  and exists (select 1 from public.automacao_passos p where p.automacao_fk = ax.automacao_fk)
  and not exists (select 1 from public.envios e where e.automacao_fk = ax.automacao_fk
                                                  and e.lead_fk = ax.lead_fk);

commit;

select column_default as novo_default
from information_schema.columns
where table_name = 'automacao_execucoes' and column_name = 'passo_atual';
