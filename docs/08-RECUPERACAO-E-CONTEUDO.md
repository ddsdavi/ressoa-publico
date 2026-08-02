# 08 — Recuperação de venda, contador, RSS e módulos

Quatro recursos que dependem uns dos outros mais do que parece. Todos se apoiam na
mesma peça: **o contexto do evento**.

---

## O contexto do evento

Uma automação sempre soube *quem* a disparou. Passou a saber também *por quê*.

Quando um evento cria uma execução, o `payload` dele viaja junto — da execução para o
envio, e do envio para o texto do e-mail. Sem isso, um e-mail de carrinho abandonado só
consegue dizer "você deixou algo para trás". Com isso, ele diz o quê.

No editor, escreva:

| No texto | Vira |
|---|---|
| `%EVENTO.produto%` | o produto que a pessoa não concluiu |
| `%EVENTO.valor%` | o valor da compra |
| `%EVENTO.titulo%` | o título do post (gatilho de RSS) |
| `%EVENTO.link%` | o endereço do post |
| `%EVENTO.resumo%` | o resumo do post |
| `%EVENTO.imagem%` | a imagem de capa do post |

Variável que o evento não trouxe é **apagada**, não sai crua para o assinante.

Também funciona em `{{evento.produto}}`, para quem prefere essa escrita.

---

## Recuperação de venda

A Hotmart já avisava quando alguém desistia no meio do caminho — o sistema guardava o
aviso e não fazia nada com ele. Agora cada um vira gatilho:

| Evento da Hotmart | Gatilho no painel |
|---|---|
| `PURCHASE_OUT_OF_SHOPPING_CART` | Abandona o carrinho |
| `PURCHASE_BILLET_PRINTED` | Gera boleto e não paga |
| `PURCHASE_DELAYED` | Pagamento atrasa |
| `PURCHASE_EXPIRED` | Pagamento expira |

Nenhum deles registra venda — a pessoa não pagou. Eles entram como evento, para não
sujar o relatório de faturamento.

Cada gatilho aceita um filtro por produto (vazio = qualquer um).

**Uma automação de carrinho abandonado que funciona:**

1. Gatilho: *Abandona o carrinho*
2. Espera: `1 hour`
3. Se / então: *comprou este produto?* → se sim, encerra
4. Envia e-mail: "Sobre o %EVENTO.produto%…"

O passo 3 é o que evita o constrangimento de cobrar quem já pagou. Sem ele, quem
abandonou o carrinho às 14h e comprou às 14h20 recebe a cobrança às 15h.

---

## Contador regressivo

Cliente de e-mail não executa JavaScript. Por isso o contador é uma **imagem**, pedida
ao servidor toda vez que a pessoa abre a mensagem — o tempo mostrado é o do momento da
abertura, não o do envio.

```
https://SEU-PROJETO.supabase.co/functions/v1/contador
  ?ate=2026-08-10T07:00:00-03:00
  &cor=6b4ea8
  &fundo=ffffff
```

| Parâmetro | O que é |
|---|---|
| `ate` | o prazo, com fuso (**sempre com `-03:00`**) |
| `cor` | cor dos dígitos, em hexadecimal sem `#` |
| `fundo` | cor de fundo, em hexadecimal sem `#` |

O bloco *Contador regressivo* no editor já entra com tudo montado — só troque a data.

Prazo vencido mostra `00:00:00:00` em vez de dar erro: e-mail antigo continua abrindo
sem imagem quebrada.

---

## RSS

Cadastre o feed em **Configurações → Conteúdo (RSS)**. O endereço é conferido na hora:
se não devolver post nenhum, não grava — feed errado gravado é automação que nunca
dispara e ninguém descobre por quê.

De hora em hora o sistema confere se saiu post novo. Quando sai, quem estiver na lista
escolhida recebe um evento `rss_novo_item`, e a automação com o gatilho **Sai um post
novo (RSS)** roda.

Só o post mais recente conta. Se saírem três de uma vez, avisa sobre o último — melhor
um aviso certo do que três seguidos.

Há também o caminho manual: no editor, o bloco *Posts do blog (RSS)* + o botão
**Buscar posts** trocam o bloco pelas publicações atuais, já formatadas. Serve para
newsletter escrita à mão.

---

## Módulos salvos

Selecione um bloco no editor e clique em **Guardar bloco**. Ele passa a aparecer na
aba *Meus módulos* de qualquer e-mail.

Cabeçalho e assinatura são os casos óbvios — antes eram remontados a cada e-mail, e
bastava um esquecimento para a marca sair diferente.

---

## Identidade visual

Em **Configurações → Identidade visual dos e-mails**: fonte, largura e quatro cores.

Vale para todo bloco **novo**. E-mail já escrito não muda sozinho — mudar o passado
estragaria campanha aprovada.

A lista de fontes é curta de propósito: só as que existem em Windows, Mac, Android e
iOS. Fonte fora dessa lista não é arriscada, é loteria — o cliente cai para o padrão
dele, e o e-mail que você conferiu não é o que a pessoa vê.
