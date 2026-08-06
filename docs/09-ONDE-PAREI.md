# 09 — Onde parei

Documento de passagem. Serve para quem pegar este projeto do zero — outra
sessão, outra conta, outra pessoa — saber em que pé está sem ter que
reconstituir a conversa.

Última atualização: 05/08/2026.

---

## O essencial em cinco linhas

- **O ActiveCampaign foi desligado e a Ressoa entrou em operação real**: o
  envio de e-mail foi destravado em 05/08/2026, por decisão explícita do dono.
- O motor roda sozinho: sete tarefas agendadas dentro do próprio Postgres,
  quatro delas a cada minuto. Os pedidos da Hotmart chegam por webhook em
  tempo real; só estado aprovado vira compra, entra em lista, ganha tag de
  turma e pode marcar a pessoa no ManyChat.
- O **histórico completo de vendas** está dentro: 10.178 transações
  (ago/2025–ago/2026) conferidas uma a uma. Faturamento em reais:
  R$ 1.770.234,87 em compras aprovadas.
- `executar_webhooks` foi **ligado em 05/08/2026** por decisão do Davi: os
  POSTs para n8n/Boost.space herdados das automações do AC voltam a sair
  quando os gatilhos (listas/tags de lançamento) receberem gente.
- 39 armadilhas conhecidas estão em [06-PROBLEMAS-CONHECIDOS.md](06-PROBLEMAS-CONHECIDOS.md).
  Vale ler antes de mexer em qualquer coisa; várias custaram horas.

---

## Travas e configurações agora

| Onde | Estado | O que significa |
|---|---|---|
| `envio_so_para` | **vazio** | O envio está DESTRAVADO. Campanha disparada vai para a base real. Para testar, coloque seu e-mail aí antes — e tire depois. |
| `envio_pausado` | desligado | A fila escoa normalmente, a 100 por minuto. |
| `executar_webhooks` | **ligado** | Automações com passo de webhook chamam n8n/Boost.space de verdade. |
| `reply_to_padrao` | contato@drapatriciadomingos.com.br | Quem responder um e-mail cai numa caixa real. |
| `provedor_email` | resend | Remetente: contato@mkt.drapatriciadomingos.com.br. |

**Atenção redobrada em teste:** com o envio destravado, QUALQUER linha
`queued` na tabela `envios` sai em até 60 segundos. Antes de testar
qualquer coisa que toque a fila, preencha `envio_so_para` com o seu
endereço (armadilha 28) — e esvazie de novo ao terminar.

---

## Decisões do Davi em 05/08/2026

- **Marcação no ManyChat é POR PRODUTO, e a maioria NÃO marca.** Correção
  do mesmo dia: a primeira leitura ("espelhar tag de todo produto") estava
  ERRADA e foi revertida — "não é pra mandar assim todos os leads pro
  manychat; só os leads que teremos fluxo de onboarding da api oficial do
  whatsapp". A regra que vale: cada produto tem o campo `tag_manychat`
  (Produtos → regra do produto) — vazio = a compra não toca o ManyChat;
  preenchido = marca. E "marcar" significa sempre as duas possibilidades
  (`manychat_aplicar` com `criar=true`): acha o contato e aplica a tag, ou
  **cria o contato e aplica** quando ele não existe lá. Hoje só o Desafio
  marca (tag semanal de turma `CASA_H_{AA}_{MM}_{DD} - COMPROU INGRESSO
  CASA_H`, virada segunda 7h São Paulo).
- **Webhooks ligados** (`executar_webhooks = true`).
- **Imersão Terapêutica não ganha regra**: o produto não é mais vendido
  ativamente (1 venda residual nos últimos 7 dias; as 2.303 são históricas).
- **Sem sincronização final do AC**: "já subi todos os leads; se perdeu
  alguém, perdeu."
- **"Cria lista Compradores produto tal"**: os cinco produtos que vendiam
  sem regra ganharam regra completa (`operacao/regras_produtos_2.sql`) —
  Livro Físico da Formação, Ímã da Prosperidade, Black Ressonante,
  Desintoxicação e Desparasitação, Alinhamento de Chakras. Cada um: lista
  "Compradores …" + tag `COMPROU_*`, reembolso/cancelamento no padrão das
  outras, ManyChat de fora. Vale para compras novas — e o mapa de produto
  voltou a rodar na noite de 05/08 (armadilha 38; o represado do período
  mudo é a pendência 5).
- **Captação por API fechada com chave.** O POST em `/formulario` **sem**
  `form_slug` — o que escolhe `lista_id`/`tag_id` no corpo — passou a exigir a
  chave `formulario_api_key` (cofre `public.segredos`), no cabeçalho
  `x-api-key` ou no campo `api_key`. Antes, qualquer anônimo inscrevia
  qualquer e-mail em qualquer lista, e com o envio destravado isso disparava
  e-mail real (armadilha 37). Formulários publicados (com `form_slug`)
  continuam públicos. A chave se troca em Configurações → API e webhooks; o
  valor atual está no `.env` local (`FORMULARIO_API_KEY`), fora do
  repositório. Ninguém usava o caminho sem slug (zero `source = form:api` na
  base) — nada quebrou.

## O que está pendente

1. **Nó "Formatar telefone" do n8n** (workflows `ySkiGv6PY1l3TPRu` e
   `d9ZmqxI1vbj80GHb`) ainda tem a regra antiga que inventa nono dígito em
   telefone fixo. A Ressoa já foi corrigida; o n8n é do Davi. Com os
   webhooks ligados, o risco voltou a ser real — pendência viva.
2. **Povoar as listas "Compradores …" com quem já comprou?** As regras
   novas valem para compras futuras; os compradores históricos (Livro
   Físico 181, Chakras 166, Black 163, Desintoxicação 106, Ímã 5 — ~620
   pessoas) ficam fora das listas até o Davi decidir. Inserir retroativo é
   seguro: lista recém-criada não tem automação pendurada, nenhum e-mail
   nem webhook sai.
3. **Verificar o primeiro disparo real de webhook.** Os gatilhos das
   automações com webhook (que moram AQUI na Ressoa e chamam n8n/Boost)
   são listas/tags de lançamento, hoje sem tráfego — o primeiro POST real
   deve acontecer no próximo lançamento. Nada a fazer; só conferir quando
   houver.
4. **Página das lives semanais sem destino.** Com o AC desligado, a inscrição
   das lives está postando para um sistema morto. As peças para ela apontar
   para cá já existem e estão testadas — ver a seção logo abaixo.
5. **Reprocessar as 227 compras aprovadas que ficaram mudas (02–05/08) —
   SÓ com o aval do Davi.** O mapa de produto ficou mudo de 02/08 16h24 a
   05/08 à noite (armadilha 38: três assinaturas de `aplicar_mapa_produto`
   conviviam; o PostgREST respondia `PGRST203` e a `venda` engolia o erro e
   carimbava processado). O conserto entrou em 05/08 à noite
   (`hotmart_v4_um_mapa_so.sql` + `venda` lendo `error`): compra nova volta
   a entrar em lista, ganhar tag e turma sozinha — e a marcar ManyChat
   onde a regra manda (hoje, só a turma do Desafio). O que NÃO foi feito,
   de propósito: reprocessar o represado — 118 compras do Desafio,
   52 da Formação, 22 do Curso energia, 13 do Livro, 8 do Manual, 5 do Ímã,
   4 da Black, 2 da Desintoxicação, 1 de Origem, 1 de Chakras, 1 do
   Acompanhamento (todas gravadas em `tabela_4_alunos`; os corpos crus
   estão em `hotmart_eventos`). Reprocessar não é neutro: os 118 do
   Desafio seriam marcados no ManyChat de uma vez (tag de turma, criando
   contato quando faltar — fluxo de WhatsApp), as listas antigas (17, 21,
   22, 23, 24, 25) podem ter automação pendurada e `executar_webhooks`
   está ligado — decisão do Davi, não de sessão. Os compradores do período
   mudo dos 5 produtos novos são um subconjunto do retroativo da pendência
   2 — as duas decisões conversam. Detalhe técnico:
   `reprocessar_evento_hotmart` calcula a turma com `now()`, então
   reprocessar antes de segunda 10/08 7h põe todo mundo na turma
   `CASA_H_2026_08_10`; depois disso, na seguinte.

---

## Lives semanais: FUNCIONANDO de ponta a ponta (06/08/2026, 23h25)

Uma inscrição real na página publicada (`biopatriciadomingos.com.br/livessemanais`)
percorreu a corrente inteira, cronometrada:

| Etapa | Prova |
|---|---|
| Página → base | lead na lista 6 com `source = form:lives-semanais` |
| Tag | `LIVES SEMANAIS - INSCRITOS` aplicada |
| E-mail | "✅ Inscrição confirmada" — `sent` pelo Resend às 23:25 |
| WhatsApp | ManyChat marcado às 23:24 (`manychat_log`, sucesso) |

**O que estava quebrado e foi consertado no meio do caminho:** a automação
"Lives Semanais" (réplica do AC, gatilho lista 6) tinha o passo de e-mail com
o config `{"assunto": "...", "mensagem": "inscricao - live semanal"}` — só o
**nome** da mensagem, herdado do AC. O executor precisa de `mensagem_id`, e sem
ele o passo passava em branco: **ninguém que se inscrevia recebia
confirmação**, e nada no painel denunciava isso (o passo aparecia montado).
Agora aponta para a mensagem `20d3fec7…` ("✅ Inscrição confirmada", que já
estava na biblioteca, vinda do AC).

**A varredura achou mais cinco no mesmo estado — todas ligadas em 06/08** a
pedido do Davi, casando pelo assunto que estava guardado no config:

| Automação ativa | Dispara quando | Agora envia |
|---|---|---|
| Hotmart Purchase Confirmation Email | ganha a tag `ALUNO_IMERSÃO_TERAPÊUTICA` | 🎉 Sua vaga na Imersão Terapêutica está confirmada! |
| LP_COMPROU_INGRESSO_IMER_TERAP | entra na lista de comprador do ingresso | Boas-vindas à Imersão Terapêutica |
| 16LC_CADASTRADOS | entra na lista `16LC_SET25` | Confirme a sua inscrição |
| 18LC_NOV25_BLACK - Inscritos | entra na lista `18LC_NOV25_BLACK` | Finalize a sua inscrição |
| LSHT_DEZ25 | entra na lista `LSHT_DEZ25` | Confirme a sua inscrição na live exclusiva |

Seguem mudas, de propósito, as duas **desligadas**: `DESAFIO_CASA_HARMONIZADA`
e `LP_2026_01_03_COMPRADORES_INGRESSO`.

> **⚠️ Texto vencido em duas delas — revisar antes que recebam tráfego.**
> As mensagens vieram do AC como estavam:
> - **Confirmação de Compra (Imersão):** diz "Data de Início: **Sábado
>   28/03/2026 09:00**" — data que já passou. É a mais urgente: o gatilho é
>   uma compra, que pode acontecer a qualquer momento.
> - **16LC_CADASTRADOS:** diz "aulas nos dias **08, 10 e 12 de Setembro, às
>   08:00**" — datas de setembro/2025.
> - **18LC_NOV25_BLACK:** manda entrar num grupo de WhatsApp com link direto
>   (`chat.whatsapp.com/HPL5…`), de novembro/2025 — pode estar cheio ou morto.
>
> As outras duas envelhecem bem: **AC #95** (Imersão) e **AC #71** (live
> exclusiva) não citam data e usam links permanentes
> (`links.drapatriciadomingos.com.br/grupo`).

A consulta que encontra passos mudos:

```sql
select a.nome, a.ativa from automacao_passos p
join automacoes a on a.automacao_id = p.automacao_fk
where p.tipo = 'enviar_email' and p.config->>'mensagem_id' is null;
```

**Horário corrigido (06/08):** o e-mail dizia "quarta-feira às 12:37" e
"às 12h37" — erro de digitação herdado do AC, enquanto a landing sempre disse
**13h**. As quatro ocorrências (HTML e texto puro) viraram `13h` a pedido do
Davi. Nenhuma outra mensagem da biblioteca citava esse horário: as duas com
"12h00" são da Formação em Biorressonância, outro assunto.

---

## Lives semanais: as peças prontas para assumir do n8n

Como era: página de inscrição → ActiveCampaign (lista "Lives Semanais") → uma
automação de lá chamava um fluxo no n8n, que marcava a pessoa no ManyChat (tag
`LIVES SEMANAIS - INSCRITOS`), criava o assinante quando faltava e somava uma
linha numa planilha do Google. Com o AC desligado esse caminho parou de
receber gente — a última execução do fluxo foi na madrugada de 05/08.

O que já existe aqui (criado e testado em 05/08/2026):

- **Tag 85 `LIVES SEMANAIS - INSCRITOS`** — o espelho, na base, da tag que o
  n8n aplicava no ManyChat.
- **Formulário publicado `lives-semanais`** — inscreve na lista 6 (Lives
  Semanais) e aplica a tag 85. Tem página própria em
  `ressoa.drapatriciadomingos.com.br/f/lives-semanais`, e aceita POST direto
  com `form_slug=lives-semanais` + `nome`, `email`, `whatsapp`. (O endereço
  `…supabase.co/functions/v1/formulario?f=slug` **não** serve como página: o
  domínio de funções devolve HTML como `text/plain`, e o visitante veria o
  código cru. Como destino de POST, é o certo.)
- **Automação "[RESSOA] Lives Semanais — tag no ManyChat"** — gatilho: tag 85
  adicionada; passo único: marcar `LIVES SEMANAIS - INSCRITOS` no ManyChat,
  criando o assinante se não existir. Nasceu **desativada**, de propósito.

O teste de 05/08: GET da página do formulário, POST no formato acima com um
lead real — achado pelo WhatsApp sem criar duplicata, tag aplicada, nenhuma
lista alterada, nenhum e-mail disparado.

A receita genérica para repetir isto em qualquer captação nova está em
[10 — Criar uma captação](10-CRIAR-UMA-CAPTACAO.md).

A ordem para concluir (revista em 05/08 à noite, com `executar_webhooks`
ligado e a decisão do Davi de manter a planilha como segurança):

1. ~~**Apontar a página de inscrição para cá.**~~ **FEITO em 06/08.** A landing
   fica no Lovable (projeto `d13360ee-f9c0-40a6-9ea8-62d5214c35e7`,
   `harmonized-home-flow`, rota `/livessemanais`); só o componente
   `src/components/LivesSemanaisLanding.tsx` foi alterado, e o formulário faz
   POST com `form_slug: lives-semanais`. Testado no navegador (card de
   confirmação + contador `formularios.envios` subindo) e **publicado pelo
   Davi**. Ao entrar na lista 6, a automação réplica "Lives Semanais" (ativa)
   manda o e-mail "Inscrição confirmada" — envio real, no lugar do que o AC
   mandava. Falta só a prova com uma pessoa NOVA (não feita de propósito:
   exigiria inventar um telefone, e número inventado pode ser de terceiro real).
2. **Planilha sem n8n (mudou em 05/08 à noite).** A pedido do Davi, o passo
   "Planilha do Google" ficou NATIVO: conta Google conectada em Configurações
   → Planilhas (setup único do app OAuth descrito lá), e o passo guarda
   planilha + aba + mapeamento coluna ↔ campo — quem escreve é a Edge
   Function `google-sheets` (log em `google_sheets_log`). Para as lives:
   acrescentar esse passo na automação "[RESSOA] Lives Semanais", apontando
   para a planilha "Lives semanais - inscritos". O modo antigo (URL de n8n)
   continua aceito nos passos que já existiam. Enquanto a réplica
   "Automação 19" (webhook para `livessemanais/inscrito`) estiver ativa com
   `executar_webhooks` ligado, cada inscrição gera uma execução quebrada no
   n8n — sem efeito além do ruído; desativar essa réplica quando o passo de
   planilha assumir.
3. ~~**Ativar a automação "[RESSOA] Lives Semanais — tag no ManyChat"**~~
   **ATIVADA E PROVADA em 06/08, 02h.** O teste foi o completo, sem simulação:
   tag 85 aplicada no lead do Davi → evento na fila → `processar_eventos_sistema`
   às 02:05:00 → `executar_automacoes` chamou o passo → ManyChat marcado às
   02:06:01 (`manychat_log`: acao "marcou", tag `LIVES SEMANAIS - INSCRITOS`,
   sucesso, assinante 1347252605), e a conta do ManyChat confirma a tag no
   assinante. **É o primeiro passo `manychat_tag` executado pelo MOTOR em
   produção** — até aqui só a tela tinha feito isso (armadilha 33).
   O `google_sheets` nativo continua sem estreia: depende da conta Google.
4. **Nada de arquivar o n8n**: decisão do Davi em 05/08 — os fluxos ficam
   como reserva. A planilha das lives passa a ser alimentada pela própria
   Ressoa (passo 2), e o registro-mestre é a base (Leads → tag 85).

Correção do mesmo dia: a nota anterior dizia que a tabela `segredos` estava
vazia — era um erro de leitura (consulta com `limit=0`, que devolve vazio por
definição). `manychat_api_key` e `service_key` estão lá desde 02/08.

---

## Importação histórica concluída

Em 02–03/08/2026, os relatórios anuais definitivos da Hotmart foram conferidos
e importados diretamente no Supabase (`scripts/importar_vendas_hotmart_csv.py`).
Eles contêm 10.178 transações únicas entre 02/08/2025 e 02/08/2026. Destas,
2.600 já estavam no Ressoa; a carga acrescentou 7.578 vendas e criou 183 leads.
Uma transação válida de um relatório anterior, imediatamente anterior ao horário
inicial do relatório anual, também foi preservada — por isso a origem
`hotmart_csv` tem 10.179 transações.

Todas as 10.178 transações dos arquivos foram reconferidas depois da carga
(em 03/08 e de novo em 05/08): faltando zero, todas com lead vinculado.
O casamento foi feito por e-mail exato sem diferença entre maiúsculas e
minúsculas; telefone conflitante foi descartado em vez de juntar pessoas
diferentes. Nenhuma automação nem e-mail foi disparado. Os CSVs e os SQLs
com dados pessoais ficaram fora do repositório.

**Moedas (corrigido em 05/08/2026):** 59 vendas foram pagas em moeda
estrangeira (CLP, COP, MXN, EUR, GBP, CHF, USD, AUD) e ficam registradas
**na moeda original** — a carga havia gravado a moeda de recebimento no
lugar da moeda da compra, o que fazia 68.304 pesos chilenos valerem
R$ 68.304. A regra de relatório (`moeda_relatorios_v1.sql`): contagem de
compras e compradores considera todo mundo; soma de dinheiro considera
só BRL.

---

## Como testar sem estragar nada

**E-mail:** o envio está DESTRAVADO. Antes de qualquer teste, coloque seu
endereço em `envio_so_para` (Configurações → E-mail) e confira com
`select public.cfg('envio_so_para')`. Ao terminar, esvazie de novo.

**ManyChat:** não há modo simulação, de propósito — o objetivo do teste é ver
a pessoa aparecendo na conta. A precaução é outra: **crie uma tag nova para
testar**. Tag recém-criada não tem automação pendurada, então nada de WhatsApp
sai. Depois apague (`removeTagByName` no assinante, `removeTag` na conta).

Toda a integração foi validada assim, e a conta ficou como estava.

A página **Automações → ManyChat** separa as operações para não haver efeito
colateral escondido:

- pessoa é procurada **somente pelo WhatsApp completo**;
- quando a busca não encontra a pessoa, a própria tela oferece a criação do
  usuário; criar não aplica tag nem roda regra de produto e impede duplicar um
  WhatsApp que já existe no campo configurado;
- "Criar tag" só cria a tag na conta;
- "Excluir" remove a tag da conta e de todos os assinantes, exige confirmação e
  só é aceito pelo servidor para um admin autenticado;
- aplicar uma tag específica não cria usuário por conta própria: primeiro é
  preciso buscar ou criar a pessoa.

Na página **Leads**, cada linha e o detalhe do lead têm a ação "ManyChat". A
gaveta procura automaticamente pelo WhatsApp da Ressoa, oferece a criação se o
usuário não existir e, quando encontra, permite aplicar ou remover tags. Leads
sem WhatsApp precisam receber o número na Ressoa antes dessas operações.

---

## Telefone: a regra que custou dois erros

O número é a chave que liga a Ressoa ao ManyChat. Errar o casamento é aplicar
tag na pessoa errada — e tag no ManyChat dispara mensagem de WhatsApp.

**A forma canônica é `DDI + DDD (sem o zero) + número`:** `5551999990000`.

Duas coisas que parecem inofensivas e não são:

1. **Comparar só o final do número junta gente diferente.** `5521 90000-0000` e
   `5511 90000-0000` têm os mesmos 10 últimos dígitos. Normalize os dois lados
   e compare inteiro — nunca trunque.
2. **Telefone fixo não ganha o nono dígito.** Desde 14/02/2017 todo celular do
   Brasil tem o 9, em todos os DDDs; não existe exceção. Então um número de 12
   dígitos ou é fixo, ou é cadastro velho de celular. Quem decide é o primeiro
   dígito depois do DDD: **2,3,4,5 = fixo** (não tem WhatsApp), **6,7,8,9 =
   celular**. Enfiar um 9 num fixo inventa o número de outra pessoa.

A regra vive em três lugares e os três precisam concordar:
`public.normalizar_telefone` (SQL), `formatarTelefone` (Edge Function do
ManyChat) e o nó "Formatar telefone" do n8n — **este último ainda tem a regra
antiga e adiciona 9 em fixo.**

---

## Mapa rápido do sistema

```
Hotmart  ──webhook──►  /functions/v1/venda
                            │
                            ├─► registra o pedido e seu estado
                            ├─► se aprovado, aplicar_mapa_produto:
                            │      lista + tag de turma + tag no ManyChat
                            └─► eventos (carrinho abandonado, boleto…)
                                    │
pg_cron (todo minuto) ──────────────┴─► processar_eventos_sistema
                                        executar_automacoes
                                        processar_fila_envios ──► Resend
                                        processar_campanhas
```

- **Motor:** `supabase/motor_v*.sql`. A ordem de aplicação está em
  `supabase/ordem.txt` — é a fonte única, lida pelos dois instaladores.
- **Funções públicas:** `app/functions/`, onze delas. Função nova precisa da
  entrada `[functions.nome]` com `entrypoint` em `supabase/config.toml` — sem
  ela o deploy falha com "Entrypoint path does not exist".
- **Painel:** `app/painel/`, React + Vite, publicado no Cloudflare Pages.

---

## Regras de trabalho que valem sempre

1. **A conta do ActiveCampaign foi desligada e continua intocável.** O que
   sobrou de acesso é somente leitura — os dados de lá são o backup histórico.
2. **Nada de dado pessoal no GitHub.** Sem `.env`, sem chave, sem `.csv`, sem
   telefone ou e-mail de gente real — nem em exemplo de documentação. O
   repositório é público.
3. **Produção é tudo junto:** GitHub, Supabase e Cloudflare atualizados na
   mesma leva. São três repositórios, e os três ficam com a mesma árvore.
4. **Não teste com leads reais.** Foi assim que quatro pessoas receberam um
   e-mail cujo corpo era a letra "a" (armadilha 28). O cron escoa a fila em
   até 60 segundos — menos do que o intervalo entre rodar o teste e ler o
   resultado. Com o envio destravado, isso vale em dobro.
5. **Tela que salva não prova que o motor executa.** Dois passos de automação
   estavam quebrados justamente porque só a tela tinha sido conferida
   (armadilha 33).
