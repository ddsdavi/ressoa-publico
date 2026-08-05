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
- 37 armadilhas conhecidas estão em [06-PROBLEMAS-CONHECIDOS.md](06-PROBLEMAS-CONHECIDOS.md).
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
  outras, ManyChat de fora. Vale para compras novas — e só produz efeito
  quando o mapa de produto voltar a rodar (pendência abaixo).
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
5. **Mapa de produto mudo desde 02/08 à tarde.** Compras aprovadas continuam
   chegando e sendo marcadas como processadas, mas a última entrada em lista
   de comprador + tag de turma vinda de compra real foi 02/08 16h24
   (Brasília); o que aparece depois (madrugada de 03/08) foi o ensaio pela
   tela. A tag `CASA_H_2026_08_10` nem chegou a ser criada, e o
   `manychat_log` está parado desde então. Coincide com a reforma dos
   estados da Hotmart — diagnosticar `venda` → `aplicar_mapa_produto` antes
   de confiar em qualquer regra nova de produto.

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
  `/functions/v1/formulario?f=lives-semanais`, e aceita POST direto com
  `form_slug=lives-semanais` + `nome`, `email`, `whatsapp`.
- **Automação "[RESSOA] Lives Semanais — tag no ManyChat"** — gatilho: tag 85
  adicionada; passo único: marcar `LIVES SEMANAIS - INSCRITOS` no ManyChat,
  criando o assinante se não existir. Nasceu **desativada**, de propósito.

O teste de 05/08: GET da página do formulário, POST no formato acima com um
lead real — achado pelo WhatsApp sem criar duplicata, tag aplicada, nenhuma
lista alterada, nenhum e-mail disparado.

A ordem para concluir (revista em 05/08 à noite, com `executar_webhooks`
ligado e a decisão do Davi de manter a planilha como segurança):

1. **Apontar a página de inscrição para cá.** De preferência direto: o POST é
   público e qualquer construtor de página faz. Ao entrar na lista 6, a
   automação réplica "Lives Semanais" (ativa) manda o e-mail "Inscrição
   confirmada" — envio real, no lugar do que o AC mandava.
2. **Adaptar o fluxo das lives no n8n para virar só a planilha.** Com
   `executar_webhooks` ligado, a réplica "Automação 19" já chama
   `livessemanais/inscrito` a cada entrada na lista 6 — mas com o payload da
   Ressoa, que o fluxo não entende. A troca: gatilho continua o mesmo
   webhook; os campos viram `contato.email`, `contato.nome`,
   `contato.whatsapp` (já normalizado — o nó "Formatar telefone" de lá, que
   ainda tem a regra velha do nono dígito, sai do caminho); os nós de
   ManyChat saem (quem marca é a Ressoa — ver "Decisões do Davi em 05/08");
   fica webhook → linha na planilha. Até essa adaptação, cada inscrição gera uma
   execução quebrada no n8n — sem efeito além do ruído, porque a busca com
   telefone vazio falha e o fluxo para.
3. **Ativar a automação "[RESSOA] Lives Semanais — tag no ManyChat"** com um
   teste controlado antes (armadilha 33: tela que salva não prova que o motor
   executa — nenhum passo `manychat_tag` rodou pelo motor em produção ainda).
   Aplicar a tag 85 num lead próprio, esperar o minuto do cron e conferir o
   `manychat_log`.
4. **Nada de arquivar o n8n**: decisão do Davi em 05/08 — a planilha é a
   segurança e continua viva, alimentada agora pela Ressoa (passo 2).

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
- **Funções públicas:** `app/functions/`, dez delas.
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
