# Vendas e Hotmart

Receber a compra no instante em que ela acontece, e saber de qual anúncio ela veio.

---

## Por que isso vale a pena

Sem essa ligação, "quem comprou" é uma planilha que alguém atualiza de vez em quando.
Com ela, comprar vira um evento do sistema: a pessoa entra na base, ganha a tag, dispara a
automação, sobe na pontuação e aparece no relatório — sozinha, em segundos.

E aparece uma resposta que nenhuma ferramenta de anúncio consegue dar: **quanto dinheiro
cada anúncio trouxe**. O Meta sabe quantos cliques ele deu; ele não sabe quanto vendeu,
porque a venda acontece fora dele.

---

## Ligar a Hotmart

No Ressoa, vá em **Desenvolvedor → API & Webhooks** e copie o endereço de venda. É este,
com o código do seu projeto:

```
https://SEU-PROJETO.supabase.co/functions/v1/venda
```

Na Hotmart: **Ferramentas → Webhook (API e notificações) → Cadastrar Webhook**

| Campo | Valor |
|---|---|
| Nome | `Ressoa` |
| URL | o endereço copiado |
| Versão | **2.0.0** |
| Produtos | **Todos os produtos** |
| Eventos | os nove eventos de pedido listados abaixo |

Três decisões aí merecem explicação.

**A versão precisa ser 2.0.0.** O sistema lê essa especificação. Em outra versão os campos
mudam de nome e nada casa.

**"Todos os produtos", não um por um.** Assim a Hotmart manda tudo e quem decide o que
fazer com cada produto é o Ressoa. Produto novo vira uma linha numa tela, não uma volta à
Hotmart.

**Marque todos os nove eventos de pedido da especificação 2.0.0:**

| Evento Hotmart | Estado no Ressoa | É compra? |
|---|---|---|
| `PURCHASE_APPROVED` | aprovada | sim |
| `PURCHASE_COMPLETE` | aprovada | sim |
| `PURCHASE_BILLET_PRINTED` | pendente | não |
| `PURCHASE_DELAYED` | pendente | não |
| `PURCHASE_EXPIRED` | expirada | não |
| `PURCHASE_CANCELED` | cancelada | não |
| `PURCHASE_REFUNDED` | reembolsada | não é mais comprador |
| `PURCHASE_CHARGEBACK` | chargeback | não é mais comprador |
| `PURCHASE_PROTEST` | chargeback/protestada | não é mais comprador |

O `purchase.status` detalha ainda estados como espera, análise, falta de fundos e reembolso
parcial. Ele prevalece sobre o nome genérico do evento. Qualquer estado futuro ainda não
mapeado é guardado no histórico bruto e retorna erro visível; nunca é presumido como venda.

---

## O hottok

A Hotmart manda um token em toda requisição, no cabeçalho `X-HOTMART-HOTTOK`. Ele é a
garantia de que o pedido veio mesmo dela.

Enquanto ele não estiver configurado, **qualquer um que descubra o endereço pode inventar
vendas** na sua base — e venda falsa contamina segmento, pontuação, relatório e faturamento.

Para configurar, grave o valor como segredo da função:

```bash
cd app
npx supabase secrets set VENDA_SEGREDO=SEU_HOTTOK --project-ref SEU-PROJETO
```

> **Não ative com um valor que você não confirmou.** Se estiver errado, o sistema passa a
> recusar venda de verdade — dano imediato e silencioso, pior do que o risco que a trava
> evita. O caminho seguro: deixe rodar sem o segredo por um tempo, confira em
> `hotmart_eventos.token_recebido` qual valor está realmente chegando, e só então ative.

---

## O que acontece quando um pedido chega

1. **O corpo cru é guardado** em `hotmart_eventos`, antes de qualquer processamento.
   Webhook de venda é dinheiro: se algo falhar no meio, a Hotmart não reenvia para sempre,
   e sem o original não há como reprocessar nem descobrir o que deu errado.
2. **A pessoa é localizada** por WhatsApp, depois por e-mail. Se não existir, é criada.
3. **O pedido é gravado** com produto, valor, forma de pagamento, parcelas, estado, evento
   de origem e a data real. Isso não o transforma em compra.
4. **A origem é aberta** em campos utilizáveis (veja abaixo).
5. **Somente se estiver aprovado**, a regra do produto é aplicada: entra na lista e ganha
   a tag.
6. **Somente a transição para aprovado** produz `compra_realizada`. Boleto, atraso e
   expiração produzem eventos próprios de recuperação; cancelamento e estorno também têm
   estados próprios.

Reenviar o mesmo evento **não duplica**: o código da transação é único e a linha existente
é atualizada. É assim que um reembolso lançado depois corrige a venda que já estava lá.

---

## Regras de produto

**Contatos → Vendas → O que cada produto faz.**

Cada regra diz: comprou este produto → entra nesta lista e ganha esta tag; pediu reembolso
→ ganha esta outra.

O reconhecimento é pelo **`ucode`**, o código que a Hotmart dá ao produto. Ele não muda
quando você renomeia o produto — o nome, sim. Parte do nome funciona como alternativa, e
se duas regras casarem, ganha a mais específica.

**Você não precisa saber os nomes de antemão.** A tela descobre os produtos a partir dos
eventos que já chegaram e oferece um botão "configurar" para cada um que ainda não tem
regra, com nome e código preenchidos.

> **Cuidado ao escolher a lista.** Entrar numa lista dispara as automações ligadas a ela —
> inclusive as que mandam e-mail. Se a lista tiver uma automação de boas-vindas, todos os
> compradores que já estão na base recebem esse e-mail na hora em que você salvar a regra.
> Para configurar sem risco, use **só a tag** e deixe a lista vazia.

---

## De onde veio a venda

A Hotmart manda a origem em dois campos comprimidos:

```
xcod : {"vsrc":"paid_metaads","url":"sualanding.com.br/","r":"instagram.com/","vid":"…"}
sck  : m=paid|s=ig|utm_id=…|co=…
```

Guardados assim eles são inúteis: o construtor de segmentos compara o campo inteiro, não
um pedaço de dentro dele. O sistema abre os dois em campos separados:

| Campo | Exemplo |
|---|---|
| Origem do tráfego | `paid_metaads` |
| Rede | `Instagram` |
| Mídia | `pago` |
| Página de captura | `sualanding.com.br/inscricao-v4` |
| Veio de (referrer) | `instagram.com` |
| ID do anúncio | `120250666388530503` |

Com isso, **Relatórios → De onde vem o dinheiro** mostra receita por origem, por rede, por
página de captura, e o ranking de anúncios por receita.

### O detalhe que torna a conta honesta

Se a origem só existir na compra, qualquer taxa de conversão sai perto de 100% — o
denominador teria apenas quem já converteu. Não é métrica, é ilusão.

Por isso **o formulário também captura a origem na captação**: quando alguém chega na sua
landing por `?utm_source=…&sck=…&xcod=…` e preenche o formulário, a origem fica gravada
nele mesmo que nunca compre. Aí o denominador passa a ser real.

Para funcionar, os links dos seus anúncios precisam levar as UTMs até a landing — que é
como o `xcod` chega até aqui.

---

## Segmentar por compra

No construtor de segmentos (**Leads → Segmento avançado**):

| Condição | Responde |
|---|---|
| Comprou (produto opcional) | quem comprou, ou quem comprou *aquele* produto |
| Quantidade de compras | quem comprou mais de uma vez |
| Total gasto | quem gastou acima de R$ X |
| Pediu reembolso | para excluir do disparo, ou tratar à parte |

Todas contam **só compra aprovada**. Reembolso e chargeback ficam de fora — quem devolveu
o produto não é comprador.

---

## Outras origens de venda

O mesmo endereço aceita um formato simples, para Kiwify, Eduzz, checkout próprio ou
importação de planilha:

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/venda" \
  -H "Content-Type: application/json" \
  -d '{"email": "comprador@email.com", "nome": "Fulana", "telefone": "61999998888",
       "produto": "Nome do Produto", "valor": 197.00, "status": "aprovada",
       "transacao": "ABC123", "data": "2026-08-01"}'
```

Status aceitos: `aprovada`, `pendente`, `reembolsada`, `parcialmente_reembolsada`,
`chargeback`, `cancelada`, `expirada`.

---

## Eventos que não são compra

A Hotmart manda muito além de venda: acesso à área de membros, módulo concluído, envio de
produto físico, troca de plano, atualização de data de cobrança.

Eles ficam **registrados como "fora do escopo"**, em cinza, com o corpo guardado. Não são
erro — e marcá-los como erro seria pior do que ignorá-los: erro vermelho para coisa normal
treina a pessoa a ignorar erro, e aí o erro de verdade passa batido.

A exceção é **cancelamento de assinatura**, que é tratado: os dados dele vêm em
`data.subscriber` em vez de `data.buyer`, e o sistema encontra a pessoa e aplica a tag de
cancelamento configurada no produto.

---

## Quando algo der errado

**Contatos → Vendas → Eventos recebidos.** Toda requisição aparece ali com o corpo
original guardado.

- **verde**: processado
- **cinza (fora do escopo)**: recebido, mas não é evento de compra
- **vermelho**: erro — passe o mouse para ver o motivo
- **nada aparecendo**: a Hotmart não chegou a chamar; o problema está na configuração lá
