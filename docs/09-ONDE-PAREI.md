# 09 — Onde parei

Documento de passagem. Serve para quem pegar este projeto do zero — outra
sessão, outra conta, outra pessoa — saber em que pé está sem ter que
reconstituir a conversa.

Última atualização: 02/08/2026.

---

## O essencial em cinco linhas

- A Ressoa está **no ar e operando sozinha**: sete tarefas agendadas dentro do
  próprio Postgres, quatro delas rodando a cada minuto. Não depende de ninguém
  estar com o computador ligado.
- As vendas da Hotmart chegam por webhook, em tempo real, e já entram em lista,
  ganham tag de turma e podem marcar a pessoa no ManyChat.
- O envio de e-mail está **travado** para dois endereços de teste (veja abaixo).
- A migração do ActiveCampaign foi uma fotografia: a base de lá continua
  recebendo gente, e a daqui só atualiza quando alguém roda o sincronizador.
- 34 armadilhas conhecidas estão em [06-PROBLEMAS-CONHECIDOS.md](06-PROBLEMAS-CONHECIDOS.md).
  Vale ler antes de mexer em qualquer coisa; várias custaram horas.

---

## Travas ligadas agora

| Onde | Estado | O que significa |
|---|---|---|
| `envio_so_para` | dois endereços de teste | Campanha disparada agora **só chega neles**. Qualquer outro destinatário fica com o envio marcado como `retido`. |
| `envio_pausado` | desligado | A fila escoa normalmente, a 100 por minuto. |
| `executar_webhooks` | desligado | Enquanto o ActiveCampaign ainda dispara, ligar isso faria a pessoa receber tudo em dobro. |

**Para começar a operar de verdade:** esvazie `envio_so_para` em
Configurações → E-mail. É uma decisão consciente, não um esquecimento.

---

## O que está pendente

1. **Tag do ManyChat por produto.** O Desafio Casa Harmonizada usa a tag
   semanal `CASA_H_{AA}_{MM}_{DD} - COMPROU INGRESSO CASA_H`, com virada
   toda segunda-feira às 7h no horário de São Paulo. Os demais produtos
   ainda dependem de o Davi informar qual tag dispara o fluxo de cada um.
2. **CSV histórico da Hotmart.** As vendas anteriores ao webhook não existem
   aqui. Sem elas, o relatório de faturamento e a pontuação por compra só
   enxergam o que entrou desde 25/07/2026.
3. **`reply_to_padrao` vazio.** O subdomínio de envio não recebe: quem
   responder leva "endereço não encontrado". Precisa apontar para uma caixa
   que existe.
4. **Sincronizar com o ActiveCampaign.** Toda vez que a diferença incomodar:
   exporte a base completa de lá e rode
   `python scripts/sincronizar_csv_ac.py "caminho/export.csv" --aplicar`.
   Ele cria quem falta e liga as tags. Não apaga nada.

---

## Como testar sem estragar nada

**E-mail:** já está travado. Adicione o seu endereço em `envio_so_para` e
dispare à vontade.

**ManyChat:** não há modo simulação, de propósito — o objetivo do teste é ver
a pessoa aparecendo na conta. A precaução é outra: **crie uma tag nova para
testar**. Tag recém-criada não tem automação pendurada, então nada de WhatsApp
sai. Depois apague (`removeTagByName` no assinante, `removeTag` na conta).

Toda a integração foi validada assim, e a conta ficou como estava.

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
                            ├─► registra a compra
                            ├─► aplicar_mapa_produto:
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

1. **A conta do ActiveCampaign é somente leitura.** Nunca apague nem altere
   nada lá.
2. **Nada de dado pessoal no GitHub.** Sem `.env`, sem chave, sem `.csv`, sem
   telefone ou e-mail de gente real — nem em exemplo de documentação. O
   repositório é público.
3. **Produção é tudo junto:** GitHub, Supabase e Cloudflare atualizados na
   mesma leva. São três repositórios, e os três ficam com a mesma árvore.
4. **Não teste com leads reais.** Foi assim que quatro pessoas receberam um
   e-mail cujo corpo era a letra "a" (armadilha 28). O cron escoa a fila em
   até 60 segundos — menos do que o intervalo entre rodar o teste e ler o
   resultado.
5. **Tela que salva não prova que o motor executa.** Dois passos de automação
   estavam quebrados justamente porque só a tela tinha sido conferida
   (armadilha 33).
