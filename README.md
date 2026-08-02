# Ressoa

Plataforma própria de e-mail marketing, automação e vendas. Substitui o ActiveCampaign
por um sistema que roda em infraestrutura de custo quase zero e que você controla inteiro.

Foi construída para operar a base da Nome do Remetente — 12 mil leads de sua área
— mas nada aqui é específico dela. Serve para qualquer operação de infoproduto.

🔗 **No ar:** https://ressoa.seudominio.com.br

---

## O que ele faz

| | |
|---|---|
| **Leads** | listas, tags, campos próprios, segmentos com E/OU, importação e exportação por CSV |
| **E-mail** | editor visual, campanhas, personalização, rastreio de abertura e clique |
| **Automações** | quadro visual com gatilhos, espera, condições se/então e integrações |
| **Formulários** | construtor com página publicada no seu próprio domínio |
| **Vendas** | recebe a Hotmart em tempo real: produto, valor, status, reembolso |
| **Atribuição** | de qual anúncio veio cada venda, com receita por origem |
| **Pontuação** | nota por lead calculada a partir do comportamento real |
| **Relatórios** | base, campanhas, tags, campos e de onde vem o dinheiro |
| **Acesso** | três níveis de usuário, com as regras dentro do banco |

E o que ele **não** faz, de propósito: SMS e WhatsApp.

---

## Quanto custa rodar

| Peça | Serviço | Custo |
|---|---|---|
| Banco, login e funções | Supabase | grátis até 500 MB |
| Painel | Cloudflare Pages | grátis |
| E-mail | Resend | grátis até 3.000/mês · depois US$ 20 |
| E-mail (alternativa) | Amazon SES | US$ 0,10 por mil |

Uma base de 12 mil leads com um disparo mensal cabe no plano grátis do Supabase e do
Cloudflare. O e-mail é o único custo real: cerca de **R$ 6 por disparo completo** no SES.

---

## Instalar do zero

Você precisa de [Node 20+](https://nodejs.org), [Python 3.10+](https://python.org), uma
conta [Supabase](https://supabase.com) e uma conta [Cloudflare](https://cloudflare.com).
As duas contas são gratuitas.

```bash
git clone <endereço-do-repositório>
cd ressoa
cp .env.example .env      # preencha as chaves — cada linha diz onde achar
./instalar.sh             # Linux e Mac
```

No Windows, o último comando é `.\instalar.ps1`.

**Um comando faz tudo:** cria as tabelas, instala as funções do banco, agenda as tarefas
automáticas, publica as 8 funções públicas e sobe o painel. No fim ele imprime o endereço
e o que fazer em seguida.

Rodar de novo é seguro — todo arquivo usa `create ... if not exists` ou
`create or replace`. Nada é apagado.

```bash
./instalar.sh --so-banco    # só o banco
./instalar.sh --so-painel   # só o painel e as funções
```

Passo a passo detalhado: **[docs/01-INSTALAR.md](docs/01-INSTALAR.md)**

---

## Documentação

| | |
|---|---|
| **[01 — Instalar](docs/01-INSTALAR.md)** | do zero até o painel no ar |
| **[02 — Arquitetura](docs/02-ARQUITETURA.md)** | como as peças se encaixam, e por quê |
| **[03 — Migrar do ActiveCampaign](docs/03-MIGRAR-DO-ACTIVECAMPAIGN.md)** | trazer contatos, listas, tags e e-mails |
| **[04 — Operação](docs/04-OPERACAO.md)** | o dia a dia: campanhas, segmentos, automações |
| **[05 — Ligar o envio real](docs/05-LIGAR-ENVIO-REAL.md)** | Resend, Amazon SES, DNS e aquecimento de domínio |
| **[06 — Armadilhas conhecidas](docs/06-PROBLEMAS-CONHECIDOS.md)** | cada uma custou horas de depuração |
| **[07 — Vendas e Hotmart](docs/07-VENDAS-E-HOTMART.md)** | receber compra em tempo real e atribuir a venda ao anúncio |
| **[08 — Recuperação e conteúdo](docs/08-RECUPERACAO-E-CONTEUDO.md)** | carrinho abandonado, contador regressivo, RSS e módulos salvos |

---

## Como está organizado

```
ressoa/
├─ instalar.sh · instalar.ps1   o instalador de um comando
├─ .env.example                 todas as chaves, com onde achar cada uma
│
├─ supabase/                    o banco, na ordem em que é aplicado
│  ├─ replica_*.sql             tabelas de negócio
│  ├─ motor_v*.sql              o motor: eventos, automações, envio
│  ├─ auth_v*.sql               contas, papéis e segurança
│  ├─ hotmart_*.sql             recebimento de vendas
│  ├─ atribuicao_*.sql          de qual anúncio veio a venda
│  └─ …                         pontuação, formulários, relatórios
│
├─ app/
│  ├─ functions/                8 funções públicas (Deno)
│  │  ├─ formulario/            captação de lead
│  │  ├─ venda/                 webhook da Hotmart
│  │  ├─ rastreio/              pixel de abertura e clique
│  │  ├─ descadastro/           página de saída
│  │  ├─ postback-resend/       retornos do Resend
│  │  ├─ postback-ses/          retornos do Amazon SES
│  │  ├─ enviar-ses/            envio assinado pela AWS
│  │  └─ conta-email/           códigos de segurança da conta
│  │
│  └─ painel/                   React + Vite (Cloudflare Pages)
│     └─ src/pages/             uma tela por arquivo
│
├─ scripts/                     migração e manutenção (Python)
└─ docs/                        a documentação
```

---

## A ideia por trás

**O motor vive dentro do banco.** Não há servidor de aplicação para manter, escalar ou
pagar. Quatro tarefas agendadas rodam a cada minuto dentro do próprio Postgres: leem a
fila de eventos, executam as automações, drenam a fila de e-mails e disparam as campanhas
agendadas.

**A segurança também.** Quem pode ver e fazer o quê é decidido por RLS no banco, não pela
tela. Mesmo que alguém pegue a chave pública e chame a API por fora, continua limitado ao
próprio nível de acesso.

**As travas são estruturais.** Quem está na supressão nunca recebe — a verificação
acontece três vezes, em momentos diferentes, e a última é no instante do envio. Um envio
por campanha por pessoa é garantido por chave única no banco, não por código que pode
falhar.

---

## Segurança e dados pessoais

O `.gitignore` bloqueia, e isso não é opcional:

- `.env` e qualquer chave — principalmente a `service_role`
- `activecampaign-export/` — dados pessoais de milhares de pessoas
- `vendas-hotmart/` — nome, e-mail, telefone e valor pago de compradores
- todo e qualquer `.csv`

Antes de publicar um fork, confira:

```bash
git ls-files | grep -E "\.env$|export/|\.csv$"
```

Não deve retornar nada.

---

## Licença

Uso interno. Não há licença aberta.
