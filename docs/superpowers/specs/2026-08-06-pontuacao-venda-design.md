# Pontuação de venda + Prontos pra comprar — design

Data: 06/08/2026 · Aprovado pelo Davi (respostas: 1A, 2A, 3A)

## O problema

A pontuação atual (`lead_pontuacao.pontos`) cumpre bem o papel de **saúde de
envio** (por quem começar o aquecimento do domínio), mas não responde a
pergunta de venda. Medido em produção em 06/08/2026:

- 57% da base está na faixa "Topo (40+)" — faixa que não discrimina;
- as regras são binárias, então o score colapsa em ~12 valores discretos
  (2.604 pessoas empatadas em 11 pontos; 2.129 em 99; 1.188 em 134);
- 6.219 dos 7.642 do topo são simplesmente "quem já comprou";
- não existe dimensão monetária, nem recência de compra, nem direção
  ("o que oferecer para esta pessoa agora?").

Decisão do Davi que rege o design: **"vendas é uma coisa e engajamento com
e-mail é outra."** São dois eixos separados; o novo eixo não mistura sinal
de e-mail.

## O que os dados provaram (base da calibração)

Números medidos no banco em 06/08/2026, só compra aprovada:

- Formação em Biorressonância Aplicada = 47% da receita total
  (R$ 836 mil de R$ 1,77 mi) com 528 compradores; ticket R$ 1.173.
- **79% dos alunos da Formação compraram um produto de entrada ANTES**
  (416 de 528). A esteira é real.
- Mediana entre a compra de entrada e a Formação: **5,6 a 10,8 dias**,
  conforme o produto. Entre 1ª e 2ª compra de quem recompra: mediana 0 dias
  (mesmo dia), p75 = 11 dias. **A janela quente dura ~2 semanas.**
- Conversão histórica entrada→Formação: Desafio 6,0%, Curso prático 10,2%,
  Chakras 12,7%, Origem das doenças 8,2%, Manual 7,5%.
- Black Ressonante: só 21 dos 163 compradores eram alunos da Formação —
  headroom grande para oferta a alunos.
- Históricos de e-mail: ~zero (8 envios reais até hoje). Sinal confiável
  hoje = compra + entrada na base + participação em lives.
- Públicos alcançáveis por e-mail hoje: 673 compraram Desafio há ≤30d sem
  Formação; 1.585 entre 30–90d; 3.577 inscritos ativos nas Lives sem
  nenhuma compra; 4.322 não-compradores entraram há 180–365d.

## O que será construído

### 1. Eixo de venda (`lead_venda`) — banco

Tabela nova `lead_venda` (1 linha por lead), recalculada por completo toda
madrugada (cron 03:44, depois da pontuação de engajamento das 03:32) e por
lead no instante em que uma compra muda (trigger em `tabela_4_alunos`, com
erro engolido para nunca travar a ingestão de venda):

- `pontos_venda` 0–100, contínuo (sem empates de milhares):
  - Comprador: recência da última compra com decaimento exponencial
    `45 × exp(−dias/45)` (meia-vida ≈ 31 dias, calibrada pela janela real
    de 5–11 dias e p75 de 11 dias) + frequência `min(compras,5) × 4` +
    gasto total em BRL por degraus (≥1500→15, ≥800→12, ≥300→9, ≥100→6,
    ≥40→4, >0→2).
  - Não-comprador: recência de entrada (30d→12, 90d→8, 180d→5, 365d→2;
    mesma regra de data real da pontuação v1.2: `greatest(created_at,
    max(lead_tags.created_at))`).
  - Sinais de intenção não-e-mail: Lives Semanais ativo (+6),
    participações históricas (`min(n,3)`).
  - Reembolso/chargeback: −40 se não tem compra aprovada; −10 se tem.
  - SEM sinal de e-mail (decisão 1A: eixos separados).
- `faixa`: por **percentil entre os alcançáveis** (nunca satura):
  `prontissimo` top 5% · `pronto` 5–15% · `aquecendo` 15–45% · `frio` resto.
  Cortes gravados em `venda_cortes` para o recálculo por lead reutilizar.
- `proxima_oferta`: árvore de decisão da esteira →
  `tratar_reembolso` | `alumni_black_acomp` | `vip_relacionamento` |
  `formacao_janela_quente` (≤30d) | `formacao_segunda_chamada` (30–90d) |
  `reativar_esteira` (>90d) | `desafio_lives` | `desafio_novos` (≤90d) |
  `aquecer_primeiro`.
- `motivo`: frase em português explicando o número ("Comprou 2x · R$ 85 ·
  última há 12 dias · Lives"), para o painel nunca mostrar score mudo.
- `alcancavel`: e-mail válido + ativo em lista + fora da supressão
  (espelha a regra do relatório "podem receber").

Funções: `recalcular_pontuacao_venda(p_lead uuid default null)` — sem
sobrecarga de nome (armadilha 38/PGRST203); RPCs de leitura
`rel_vendas_jogadas()` e `rel_melhores_leads(p_oferta, p_limite)`.

### 2. Segmentos entendem o eixo de venda

`leads_do_segmento()` (versão viva = motor_v3_3) ganha três condições,
mantendo todas as existentes:
- `pontuacao_venda` (operador maior/menor + valor);
- `proxima_oferta` (igualdade com o slug da jogada);
- `comprou` ganha `dias` opcional (compra aprovada nos últimos N dias).

Com isso qualquer jogada vira segmento, e Campanhas já sabe mirar segmento
— nada muda no disparo.

### 3. Aba "Prontos pra comprar" (Relatórios)

Nova aba logo depois de "A base", 100% em `Relatorios.tsx` (arquivo limpo;
`Leads.tsx` está com trabalho não commitado de outra sessão e NÃO será
tocado nesta leva):

- Cartão-explicação dos dois eixos (venda ≠ engajamento).
- Um cartão por jogada: título, quem entra, o que oferecer, por que
  funciona (números históricos desta análise), contagem ao vivo e botão
  **"Criar segmento"** (gateado por `podePreparar`) que insere em
  `segmentos` a definição `{campo: 'proxima_oferta', valor: slug} +
  {campo: 'nao_suprimido'}`.
- Tabela "Os melhores leads agora": top 50 alcançáveis por
  `pontos_venda`, com faixa, próxima oferta e motivo; filtro por jogada.

### 4. Fora do escopo desta leva (decisões 2A e restrições)

- Automação da janela quente (e-mails automáticos): próxima leva, com
  textos do Davi. Nada dispara e-mail, nada marca ManyChat, `envio_so_para`
  não é tocado.
- Coluna/filtro de venda na página Leads e condição nova no construtor
  visual: quando `Leads.tsx` estiver livre.
- O eixo `pontos` (engajamento) permanece intacto.

## As jogadas (estratégia de venda que o painel passa a mostrar)

| Jogada | Público (medido 06/08) | Oferta | Fundamento |
|---|---|---|---|
| Formação — janela quente | 673 | Formação | 79% dos alunos vieram de entrada; conversão em 6–11 dias |
| Formação — segunda chamada | 1.585 | Formação (condição especial) | pool 30–90d ainda morno |
| Reativar esteira | ~1.170+ | novo ciclo Desafio/Código | comprador >90d esfriando |
| Aluno → Black/Acompanhamento | ~490 | Black ou recorrência | só 21/163 da Black eram alunos |
| Lives → Desafio | 3.577 | Desafio R$ 36 | audiência semanal que nunca comprou |
| Novos → Desafio | ~800 | Desafio R$ 36 | entrou há ≤90d, custo de entrada mínimo |
| Aquecer primeiro | ~4.300 | conteúdo, sem oferta | 180–365d sem compra; proteger domínio |

## Verificação (sem teste automatizado no projeto; verificação em produção)

1. Após aplicar o SQL: distribuição de `faixa` (top 5% ≈ 570), zero leads
   sem linha em `lead_venda`, amostra de `motivo` legível, contagens por
   `proxima_oferta` batendo com os números desta análise (±ruído do dia).
2. `contar_segmento` com as condições novas retorna os mesmos números das
   RPCs.
3. Build limpo (`tsc` + vite), bundle publicado com `hkku` presente e
   marcador de texto da aba nova; conferência visual no Chrome logado.
4. Papéis: assistente lê a aba e cria segmento; disparo continua gateado.
