# Pontuação de venda + Prontos pra comprar — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (execução inline nesta sessão, escolha 3A do Davi). Steps use checkbox syntax.

**Goal:** segundo eixo de pontuação (venda), carimbo de próxima oferta por lead,
condições novas de segmento e aba "Prontos pra comprar" nos Relatórios — até o
deploy total (GitHub + Supabase + Cloudflare).

**Architecture:** tabela materializada `lead_venda` recalculada por cron diário +
trigger por compra; RPCs de leitura para o painel; extensão do
`leads_do_segmento` vivo (= motor_v3_3) com 3 condições; aba nova 100% em
`Relatorios.tsx`. Spec: `docs/superpowers/specs/2026-08-06-pontuacao-venda-design.md`.

**Tech Stack:** Postgres (plpgsql, pg_cron), PostgREST/Supabase, React+Vite.

## Global Constraints

- Dois eixos separados: NENHUM sinal de e-mail entra em `pontos_venda` (decisão 1A).
- Nada dispara e-mail/ManyChat; `envio_so_para` intocado; automação fica pra depois (2A).
- `Leads.tsx`, `Dashboard.tsx` e demais arquivos sujos da sessão paralela: NÃO tocar.
- Commits nominais (nunca `git add -A`); `git fetch --all` + `pull --rebase` antes de push.
- Build de deploy SEMPRE de worktree limpo no commit empurrado, copiando
  `app/painel/.env.local`; conferir `hkku` no bundle antes e depois de publicar.
- SQL com acento aplicado só via `scripts/run_sql_file.py` (UTF-8), nunca curl inline.
- Função nova sem sobrecarga de nome (armadilha 38 / PGRST203).
- Texto do painel nunca menciona Supabase.

---

### Task 1: Migração `supabase/pontuacao_venda_v1.sql`

**Files:** Create `supabase/pontuacao_venda_v1.sql`; Modify `supabase/ordem.txt` (append no fim).

**Produces (interfaces que o resto consome):**
- Tabela `lead_venda(lead_fk uuid pk, pontos_venda int, faixa text, proxima_oferta text, motivo text, ultima_compra date, compras int, gasto_total numeric, alcancavel bool, calculado_em timestamptz)` — RLS select p/ authenticated.
- Tabela `venda_cortes(nome text pk, corte int)` — interna (RLS sem policy).
- `recalcular_pontuacao_venda(p_lead uuid default null) returns int` — completo quando null (recomputa cortes+faixas), pontual quando lead (usa cortes gravados).
- Trigger `trg_venda_recalcula` em `tabela_4_alunos` (after insert/update of status, valor, nome_produto) com erro engolido em warning.
- `rel_vendas_jogadas() returns table(oferta text, leads bigint)` — só alcançáveis.
- `rel_melhores_leads(p_oferta text default null, p_limite int default 50) returns table(lead_id, nome, email, whatsapp, pontos_venda, faixa, proxima_oferta, motivo, gasto_total)`.
- `leads_do_segmento` (REPLACE da versão viva) com: `comprou` + `dias` opcional; `pontuacao_venda` (operador/valor); `proxima_oferta` (valor = slug).
- Cron `pontuacao-venda-diaria` às 03:44 (depois do `pontuacao-diaria` 03:32).

Fórmula e árvore de oferta: exatamente as do spec (§1). Slugs:
`tratar_reembolso, alumni_black_acomp, vip_relacionamento, formacao_janela_quente,
formacao_segunda_chamada, reativar_esteira, desafio_lives, desafio_novos, aquecer_primeiro`.
Casamento de produto por `ilike`: `%Formação em Biorressonância Aplicada%`,
`%Black Ressonante%`, `%Acompanhamento Ressonante%` (conferido: nenhum outro
produto colide com esses padrões).

- [ ] Step 1: escrever o arquivo SQL completo (código = o próprio artefato commitado).
- [ ] Step 2: acrescentar `supabase/pontuacao_venda_v1.sql` ao `ordem.txt`.
- [ ] Step 3: `git add supabase/pontuacao_venda_v1.sql supabase/ordem.txt docs/superpowers/...` e commitar.

### Task 2: Aplicar em produção e verificar

- [ ] Step 1: `python scripts/run_sql_file.py supabase/pontuacao_venda_v1.sql` (o arquivo termina com `select recalcular_pontuacao_venda()` + selects de conferência).
- [ ] Step 2: verificação read-only (esperados da análise de 06/08, ±ruído):
  - todo lead tem linha em `lead_venda` (13.3xx);
  - `faixa='prontissimo'` ≈ 5% dos alcançáveis (~570);
  - `formacao_janela_quente` ≈ 670–700; `formacao_segunda_chamada` ≈ 1.550–1.650; `desafio_lives` ≈ 3.5xx;
  - amostra de 5 `motivo` legíveis com acento íntegro (marca do encoding);
  - `contar_segmento('{"op":"and","condicoes":[{"campo":"proxima_oferta","valor":"formacao_janela_quente"},{"campo":"nao_suprimido"}]}')` = contagem da RPC.
- [ ] Step 3: qualquer divergência grande → investigar antes de seguir (não seguir com número quebrado).

### Task 3: Aba "Prontos pra comprar" no `Relatorios.tsx`

**Files:** Modify `app/painel/src/pages/Relatorios.tsx` (arquivo limpo hoje — conferir `git status` antes).

- [ ] Step 1: import `useSessao`; tipos `Jogada`/`MelhorLead`; estados; fetch `rel_vendas_jogadas` no mount e `rel_melhores_leads` reagindo ao filtro.
- [ ] Step 2: aba nova `["prontos", "Prontos pra comprar"]` logo após `"A base"`; união de tipo do estado `aba`.
- [ ] Step 3: JSX: caixa-explicação dos dois eixos ("vendas é uma coisa, engajamento de e-mail é outra"); tabela de jogadas (título/quem/porquê + leads ao vivo + botão "Criar segmento" gateado por `podePreparar`, inserindo em `segmentos` a definição `{op:'and', condicoes:[{campo:'proxima_oferta', valor:slug},{campo:'nao_suprimido'}]}`); tabela top-50 com faixa (et-verde/et-roxa/et-amarela/et-cinza), pontos, oferta e motivo, filtro por jogada via `Escolher`.
- [ ] Step 4: `npm --prefix app/painel run build` limpo (tsc + vite).
- [ ] Step 5: commit nominal de `Relatorios.tsx`.

### Task 4: Documentação

- [ ] Step 1: seção nova em `docs/07-VENDAS-E-HOTMART.md` ("Quem está pronto pra comprar": os dois eixos, as jogadas, como virar segmento e campanha).
- [ ] Step 2: RELER `docs/09-ONDE-PAREI.md` (sessões paralelas!) e acrescentar o registro do dia.
- [ ] Step 3: commit nominal dos docs.

### Task 5: Deploy total

- [ ] Step 1: `git fetch --all` + `git pull --rebase origin main` + `git push origin main`.
- [ ] Step 2: worktree limpo no commit empurrado; copiar `app/painel/.env.local`; `npm ci`/`npm install` se preciso + build.
- [ ] Step 3: `grep hkku` e marcador "Prontos pra comprar" no `dist/assets/index-*.js` do worktree.
- [ ] Step 4: `CLOUDFLARE_ACCOUNT_ID=a870ba52237cc35e5781d7c11949c374 npx wrangler pages deploy dist --project-name ressoa --branch main`.
- [ ] Step 5: baixar o bundle PUBLICADO e conferir o marcador (nunca confiar no dist local).

### Task 6: Verificação final

- [ ] Step 1: RPCs respondem com a chave anon (papel de sessão real).
- [ ] Step 2: abrir o painel logado no Chrome do Davi (autorização permanente) → aba renderiza, números batem, criar segmento funciona.
- [ ] Step 3: relatório final ao Davi com o que foi atualizado em cada um dos três lugares.

## Self-review do plano

- Cobertura do spec: §1→Task 1-2, §2→Task 1, §3→Task 3, §4 (fora de escopo) respeitado nas Global Constraints, verificação→Task 2/6. Sem lacunas.
- Sem placeholders: os passos apontam para artefatos reais criados nas mesmas
  tasks; fórmulas/slugs/condições estão especificados aqui e no spec.
- Consistência de nomes: `recalcular_pontuacao_venda`, `lead_venda`,
  `venda_cortes`, `rel_vendas_jogadas`, `rel_melhores_leads`, slugs — únicos e
  idênticos em todas as tasks.
