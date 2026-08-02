# Armadilhas conhecidas

Cada item aqui custou tempo real de depuração. Leia antes de mexer na parte correspondente.

---

## 1. A API do banco corta em 1.000 linhas — nunca some no navegador

**Sintoma:** contagens absurdamente erradas nas telas de Listas e Tags.

**Causa:** o painel buscava todos os vínculos (`lead_listas`, N linhas) para contar no
navegador. O PostgREST devolve no máximo **1.000 linhas** por requisição, silenciosamente.
A conta saía feita sobre 7% dos dados.

**Regra:** qualquer contagem, soma ou média **é feita no banco** — com função SQL
(`contagem_listas()`, `contagem_tags()`) ou `count: 'exact', head: true`.
Nunca traga linhas para contar no front.

---

## 2. Acento vira `?` quando gravado via `curl` no Windows

**Sintoma:** "a dona da conta" gravada como `Patr<?>cia` (bytes `efbfbd` = caractere de erro).

**Causa:** JSON inline no `curl` pelo Bash do Windows converte o texto para cp1252 e perde o acento.

**Regra:** para gravar texto com acento, use **arquivo `.sql` em UTF-8**
(`python scripts/run_sql_file.py arquivo.sql`) ou Python com
`json.dumps(..., ensure_ascii=False).encode('utf-8')`. Nunca `-d '{"nome":"a dona da conta"}'`.

**Como detectar:** `select ... where campo like '%' || chr(65533) || '%'`

---

## 3. Tabela criada pela API não tem permissão para o PostgREST

**Sintoma:** `permission denied for table X` mesmo com as políticas certas.

**Causa:** tabelas criadas via Management API não herdam os `grant` que o painel do Supabase
aplica automaticamente.

**Solução:** depois de criar tabelas, rode:

```sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
```

Quem protege os dados são as **policies** (RLS), não a ausência de grant.

---

## 4. A Management API do Supabase bloqueia o User-Agent padrão do Python

**Sintoma:** `HTTP 403: error code: 1010` em toda chamada.

**Causa:** o Cloudflare na frente da `api.supabase.com` bloqueia o User-Agent do `urllib`.

**Solução:** mande um User-Agent qualquer:
```python
headers={"User-Agent": "ressoa/1.0", ...}
```

---

## 5. `id_greater` da API do ActiveCampaign devolve ordem aleatória

**Sintoma:** exportação de contatos trouxe 201 de N e parou.

**Causa:** o parâmetro `id_greater` não garante ordenação — a paginação entra em loop.

**Solução:** pagine por **`offset`**. Confira o total pelo `meta.total` da resposta.

---

## 6. O endpoint global `/contactTags` do AC pula registros

**Sintoma:** faltaram 4.462 associações de tag (28% do total), com repetição de itens.

**Causa:** paginação instável no endpoint global.

**Solução:** busque **tag por tag** (`/contacts?tagid=X`) e confira cada uma contra o
`subscriber_count` oficial da tag. Foi assim que fechamos N associações, 1:1 com o AC.

---

## 7. Personalização do e-mail de login exige SMTP próprio

**Sintoma:** `Email template modification is not available for free tier projects`.

**Causa:** o Supabase só deixa personalizar os e-mails de autenticação com SMTP próprio.
Além disso, o serviço de e-mail padrão dele é limitado a poucos envios por hora.

**Solução adotada:** o Ressoa **não usa** o e-mail do Supabase para recuperar senha.
Tem fluxo próprio (`conta-email` → código de 6 dígitos → e-mail da marca pelo webhook).

---

## 8. Link de recuperação do Supabase loga direto, sem pedir senha nova

**Sintoma:** clicar no link do e-mail entrava na conta sem trocar a senha.

**Causa:** o fluxo PKCE (`?code=`) troca o código por sessão automaticamente.

**Solução:** fluxo próprio com código digitado (item 7). A tela de login também detecta
links antigos (`type=recovery` ou `?code=`), desloga e manda pedir um código novo.

---

## 9. Escala de texto: `zoom` está errado

**Sintoma:** aumentar a fonte dava zoom na tela inteira, incluindo menus e espaçamentos.

**Solução:** escalar **só o texto**, com a variável `--escala-texto` multiplicando todo
`font-size` (`calc(14px * var(--escala-texto))`), inclusive os estilos embutidos nos
componentes. Layout, ícones e larguras ficam intactos.

---

## 10. Conta Cloudflare do domínio ≠ conta do projeto

**Sintoma:** `Authentication error [code: 10000]` ao publicar ou anexar domínio.

**Causa:** o wrangler estava logado numa conta e a zona do domínio estava em outra.

**Solução:** `npx wrangler login` e escolher a conta **dona do domínio**; criar o projeto
Pages nessa mesma conta. O token OAuth do wrangler **lê** zonas mas **não escreve DNS** —
o registro CNAME precisa ser criado à mão no painel.

---

## 11. Uma regra de CSS do mobile escondia controles

**Sintoma:** o "A" do seletor de tamanho de texto sumia no celular.

**Causa:** `.ac-topbar .direita span { display: none }` escondia **todos** os spans, não só o nome.

**Solução:** usar filho direto — `.ac-topbar .direita > span`.

---

## 12. Balão do tour fugia da tela em alvos altos

**Sintoma:** no passo da barra lateral, o balão saía do campo de visão.

**Causa:** a posição era calculada só como "abaixo ou acima" do alvo. Alvo do tamanho da
tela não deixa espaço em nenhum dos dois.

**Solução:** tentar abaixo → acima → ao lado → centro, e **travar dentro da tela** no fim.

---

## 13. Automação "concluída" que nunca executou nada

**Sintoma:** execuções aparecem com status **concluída** e nenhum passo aconteceu. Nenhum
erro, nenhum alerta.

**Causa:** `automacao_execucoes.passo_atual` tinha `default 0`, mas os passos são numerados
a partir de **1**. Toda execução criada por gatilho procurava o passo 0, não achava, e se
marcava concluída na hora.

**Por que é grave:** terminava com status de **sucesso**. O relatório mostrava execuções
concluídas e ninguém desconfiava. Nenhuma automação por gatilho jamais funcionou até isso
ser descoberto.

**Como detectar:**
```sql
select passo_atual, status, count(*) from public.automacao_execucoes group by 1,2;
```
Se houver `passo_atual = 0` com `concluida`, é este bug.

**Regra:** ao mudar o filtro de status ou o contador do executor, rode
`supabase/teste_automacao.sql` — ele prova a cadeia inteira e não manda e-mail.

---

## 14. Variável CSS que não existe vira transparente, sem avisar

**Sintoma:** o quadro da automação aparecia **por cima da lista**, com as duas telas
visíveis ao mesmo tempo.

**Causa:** `background: var(--fundo)` com `--fundo` inexistente. O navegador não reclama —
simplesmente não aplica cor. Os nomes reais tinham prefixo `--ac-`.

**Regra:** antes de usar uma variável, confira que ela existe:
```bash
grep -o "var(--[a-z0-9-]*" src/**/*.tsx | sort -u
grep -o "^\s*--[a-z0-9-]*:" src/index.css | sort -u
```
A segunda lista precisa conter a primeira.

---

## 15. Caixa de marcar gigante

**Sintoma:** cada `checkbox` virava um quadrado de 38 px ocupando a linha toda.

**Causa:** a regra `input, select, textarea { width: 100%; height: 38px }` vale para
**todo** input, inclusive checkbox e radio.

**Solução:** regra própria depois da genérica, com `width: auto; height: auto`.

---

## 16. HTML servido por Edge Function não renderiza

**Sintoma:** a página do formulário voltava como **código-fonte** em vez de página.

**Causa:** o Supabase força `Content-Type: text/plain` e `nosniff` em HTML servido pelo
domínio de funções — proteção contra hospedarem página falsa lá.

**Solução:** servir a página pelo domínio do próprio painel. Ficou melhor: endereço próprio
passa mais confiança numa página de captação.

---

## 17. Hotmart manda o DDD separado

**Sintoma:** telefone do comprador chegando sem DDD e virando contato duplicado.

**Causa:** para brasileiros, a Hotmart manda `buyer.checkout_phone_code` (o DDD) e
`buyer.checkout_phone` (o resto) em **campos diferentes**.

**Solução:** concatenar antes de normalizar.

---

## 18. `price` não é o que o cliente pagou

**Sintoma:** total gasto por cliente subestimado em toda compra parcelada.

**Causa:** `purchase.price` é o valor da oferta. `purchase.full_price` é o que a pessoa
**realmente pagou**, com taxas e juros. Num teste: 197 contra 227,50.

**Regra:** para receita e total gasto, use sempre `full_price`.

---

## 19. Taxa de conversão com denominador enviesado

**Sintoma:** "97% de conversão" no relatório de origem — número bom demais.

**Causa:** a origem só era gravada quando vinha **junto com a compra**. O denominador
continha apenas quem já tinha convertido, então qualquer percentual dava perto de 100%.

**Por que é grave:** leva a colocar mais verba com base numa conta que não significa nada.

**Solução:** capturar a origem também na **captação** (formulário lê `utm_*`, `sck` e
`xcod` da URL). Enquanto não houver leads sem compra com origem, o painel exibe o aviso em
vez do número.

---

## 20. Nunca ligue validação de token sem confirmar o valor

**Sintoma potencial:** o sistema passa a recusar vendas reais.

**Regra:** ativar uma verificação com o valor errado é **pior** do que o risco que ela
evita — perder venda é dano imediato e silencioso.

**Caminho seguro, nesta ordem:**
1. capturar o token recebido sem exigir nada
2. conferir que todas as requisições trazem o **mesmo** valor
3. conferir que **nenhuma** requisição chega sem token depois que a captura entrou no ar
4. só então ativar, e testar os três casos: sem token, token errado, token certo

---

## 21. Upsert de reembolso apagando dados da venda

**Sintoma:** depois do reembolso, a venda ficava sem forma de pagamento e sem parcelas.

**Causa:** o evento de reembolso não traz esses campos, e o upsert gravava nulo por cima
do que a venda original tinha. O status ficava certo e o resto sumia.

**Regra:** em upsert de evento parcial, o que chega vazio precisa **preservar** o que já
estava lá — leia a linha existente e faça o merge.

---

## 22. Chave errada no JSON do segmento passa despercebida

**Sintoma:** um segmento devolvia a base inteira para qualquer valor de filtro.

**Causa:** o construtor espera `{"campo": "..."}`; foi enviado `{"tipo": "..."}`. Sem
correspondência, o predicado vira nulo e a condição é **descartada em silêncio** — não dá
erro, só devolve tudo.

**Como detectar:** teste com dois ou três valores diferentes. Se o número não mudar, a
condição não está sendo aplicada.

---

## 23. Chave de serviço em tabela que o painel lê

**Sintoma:** nenhum. Esse é o ponto.

**Causa:** para o agendamento chamar uma Edge Function, a chave de serviço foi guardada
em `app_config`. Só que a tela de Configurações carrega `app_config` **inteiro** — ou seja,
a chave que ignora todo o RLS passaria a trafegar para o navegador de quem é admin.

**Regra:** segredo não mora em tabela que alguém lê pelo PostgREST. Vai para
`public.segredos`, que tem RLS ligado e **nenhuma policy** — sem policy, ninguém passa —
e é lido só por função `security definer`.

**Como conferir:**

```bash
curl -s "$SUPABASE_URL/rest/v1/segredos?select=*" -H "apikey: $SUPABASE_ANON_KEY"
```

Tem que responder `permission denied`. Se devolver linha, pare tudo e conserte.

---

## 24. Contador regressivo não pode ser JavaScript

**Sintoma:** o contador fica parado, ou some.

**Causa:** cliente de e-mail não executa JavaScript. Gmail, Outlook e Apple Mail
descartam `<script>` inteiro.

**Regra:** contador em e-mail é **imagem**, pedida ao servidor a cada abertura. É por isso
que `/contador` devolve PNG com `Cache-Control: no-store` — com cache, a segunda abertura
mostraria o tempo da primeira.

---

## 25. Variável de evento que não existe vaza para o assinante

**Sintoma:** o assinante recebe "Você deixou %EVENTO.produto% para trás".

**Causa:** a automação foi disparada por um gatilho que não carrega aquele dado, e o
texto saiu cru.

**Regra:** depois de substituir o que existe, **apague o que sobrou**. É o que
`personalizar()` faz com as duas expressões regulares no fim — melhor uma frase com um
buraco do que uma frase com código.

---

## 26. `\n` literal em script de instalação

**Sintoma:** o instalador falha dizendo que não achou o arquivo `n`.

**Causa:** o arquivo foi escrito com `\n` literal em vez de quebra de linha real. Em
shell, `\n` fora de aspas é só a letra `n` — cada um vira um argumento solto.

**Por que passou:** `bash -n` valida **sintaxe**, e a sintaxe estava correta. Só um teste
que confira se cada caminho da lista existe pega isso:

```bash
sed -n '/for sql in/,/^  do/p' instalar.sh | grep -o 'supabase/[a-z0-9_]*\.sql' \
  | while read f; do [ -f "$f" ] || echo "INEXISTENTE: $f"; done
```

---

## 27. Extensão do navegador bloqueando o painel

**Sintoma:** página em branco no domínio próprio; `#root` sem filhos e **nenhum erro** no
console. O mesmo endereço abre normalmente em outro navegador.

**Causa:** uma extensão (bloqueador de anúncios ou de rastreadores) barrou o download do
bundle naquele domínio. O sinal é `Failed to fetch dynamically imported module` com o
arquivo respondendo HTTP 200 no `curl`.

**Como separar do problema real:** abra o endereço `.pages.dev` do mesmo deploy. Se ele
funciona e o domínio próprio não, o problema é do navegador, não da publicação.

---

## 28. Testar o motor de envio com leads reais

**O que aconteceu:** uma prova do teste A/B enfileirou dez contatos reais da base. O
comentário no próprio arquivo dizia "nenhum e-mail sai, porque `processar_fila_envios`
não é chamado aqui". Estava errado — o **cron** chama, de minuto em minuto. Quatro
pessoas receberam um e-mail cujo corpo era a letra "a" ou a letra "b".

**Por que a intuição falha:** num sistema comum, nada acontece até você mandar
acontecer. Aqui não: existe um agendamento rodando o tempo todo. Qualquer linha em
`envios` com status `queued` **vai sair**, e o tempo entre enfileirar e enviar é de
até sessenta segundos — menos do que o intervalo entre rodar o teste e ler o resultado.

**A correção não é cuidado, é freio.** Duas travas em `app_config`, respeitadas por
`processar_fila_envios`:

| Chave | Efeito |
|---|---|
| `envio_pausado` | `true` para a fila inteira. Nada escoa, nada se perde. |
| `envio_so_para` | Enquanto tiver endereços, só eles recebem. O resto vira `retido`. |

**Antes de qualquer teste que toque na fila:**

```sql
update public.app_config set valor = 'seu@email.com' where chave = 'envio_so_para';
```

E confira que pegou, antes de enfileirar:

```sql
select public.cfg('envio_so_para');
```

**Detalhe que só aparece testando:** `retido` precisou entrar na restrição
`envios_status_check`. Sem isso, a trava derrubava a transação inteira — o que, por
sorte, também segurava o envio. Uma trava que falha fechada é uma trava; uma que falha
aberta é um enfeite.

---

## 29. `.ps1` em UTF-8 sem BOM: o travessão vira aspa

**Sintoma:** `instalar.ps1` não rodava em nenhuma máquina Windows. Erro de sintaxe numa
linha que estava visivelmente correta.

**Causa:** o Windows PowerShell 5.1 lê arquivo `.ps1` sem BOM como **ANSI**, não UTF-8.
O travessão `—` é `E2 80 94` em UTF-8; lido como cp1252, o último byte (`0x94`) é a aspa
dupla de fechamento `"`. O PowerShell aceita aspas tipográficas como delimitador de
string — então a string terminava no meio da frase, e todo o resto do arquivo passava a
ser interpretado errado.

**Correção:** gravar `.ps1` como **UTF-8 com BOM**.

**Como conferir sem uma máquina Windows à mão:**

```bash
head -c 3 instalar.ps1 | xxd | grep -q "efbb bf" && echo "tem BOM" || echo "SEM BOM"
```

**Por que passou tanto tempo:** o `instalar.sh` era testado com `bash -n`; o `.ps1`
nunca foi testado com nada. Agora é, com o próprio parser do PowerShell:

```powershell
$e = $null
[System.Management.Automation.Language.Parser]::ParseFile("instalar.ps1", [ref]$null, [ref]$e)
$e.Count   # tem que ser 0
```

---

## 30. `<>` contra NULL não protege nada

**Sintoma:** nenhum. A função parecia checar permissão e não checava.

```sql
if public.papel_atual() <> 'admin' then
  raise exception 'só admin muda segredo';
end if;
```

Para quem não está logado, `papel_atual()` devolve `NULL`. Em SQL, `NULL <> 'admin'`
não é verdadeiro nem falso — é `NULL`. O `if` só dispara com verdadeiro, então **a
exceção nunca era levantada** e qualquer um com a chave pública (que vai dentro do
JavaScript do painel, visível para o mundo) podia gravar o segredo.

**Correção:** `is distinct from`, que trata NULL como valor:

```sql
if public.papel_atual() is distinct from 'admin' then
```

`coalesce(public.papel_atual(), '') <> 'admin'` também resolve.

**Como achar os outros:** procure comparações de papel/permissão com `<>` ou `!=`.

```bash
grep -rn "papel_atual() *<>\|papel_atual() *!=" supabase/
```

**Como testar:** um `curl` anônimo, com a chave pública, contra a função. Se ele
consegue fazer algo, qualquer visitante consegue.

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/SUA_FUNCAO" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{...}'
```

Esperado: erro de permissão. Foi assim que este apareceu — o teste devolveu
`"guardado"` onde deveria devolver recusa.

---

## 31. ManyChat: a busca por e-mail/telefone não acha ninguém

**Sintoma:** `findBySystemField` responde `{"data":[]}` para todo mundo — inclusive para
um assinante cujo número você acabou de ler na própria API.

**Três causas empilhadas, e todas precisam ser resolvidas:**

1. **`data` é uma LISTA**, não um objeto. Ler `data.id` devolve `undefined` mesmo quando
   encontrou. Use `data[0].id`.

2. **A API aceita só `phone` ou `email`.** Qualquer outro parâmetro devolve
   `"Only phone or email can be specified"`.

3. **Numa conta de WhatsApp/Instagram, esses dois campos vêm vazios.** O número fica em
   `whatsapp_phone`, que **não é pesquisável**. Então não existe formato de telefone que
   funcione — o problema não é o `+55`.

**A saída é inverter o sentido.** Quem sabe quem é a pessoa é o ManyChat. Dentro do fluxo
dele, uma ação **External Request** manda o `subscriber_id` para a Ressoa, que guarda em
`tabela_1_leads.manychat_id`. Daí em diante marcar é direto, sem busca:

- URL: `POST https://SEU-PROJETO.supabase.co/functions/v1/manychat`
- Corpo:

```json
{"subscriber_id":"{{user_id}}","email":"{{email}}",
 "whatsapp":"{{phone}}","nome":"{{first_name}} {{last_name}}"}
```

A Ressoa casa por `manychat_id`, depois por e-mail, depois por WhatsApp — e cria o
contato se não achar nenhum. Foi assim que um assinante real da conta foi reconhecido
**pelo WhatsApp** e ligado ao lead que já existia aqui.

---

## 32. `addTagByName` não cria a tag

**Sintoma:** `{"message":"Tag does not exist"}`, e a tag não é aplicada.

Ao contrário do que o nome sugere, o endpoint só aplica tag que já existe. É preciso
`POST /fb/page/createTag` antes.

**Ordem que vale a pena:** tentar aplicar primeiro e criar só ao esbarrar no erro. O caso
comum é a tag já existir, e criar antes gastaria uma chamada em toda marcação.

**Cuidado ao testar:** aplicar uma tag pode disparar uma automação no ManyChat e mandar
mensagem de WhatsApp para uma pessoa real. Teste com uma tag **inédita** — tag recém-criada
não tem automação pendurada — e apague depois (`removeTagByName` no assinante e
`removeTag` na conta).

---

## 33. Tipo de passo desencontrado entre a tela, a tabela e o motor

Um passo de automação existe em três lugares, e nada garante que os três combinem:

1. o catálogo da tela (`ACOES` em `FluxoAutomacao.tsx`);
2. a restrição `automacao_passos_tipo_check`;
3. os `elsif` dentro de `executar_automacoes()`.

Dois estragos diferentes, conforme onde a lista fura:

**A tela oferece e a tabela recusa** → erro ao salvar. Chato, mas aparece na cara de quem
está montando. Era o caso de `manychat_tag` e `google_drive`.

**A tela oferece, a tabela aceita, e o motor não conhece** → o passo é salvo, a automação
roda, o passo é **pulado sem fazer nada** e marcado como concluído. Ninguém fica sabendo.
Era o caso de "Descadastra de uma lista": a tela salvava `desinscrever_lista` e o motor só
procurava por `remover_lista`.

O segundo é muito pior, porque a automação parece saudável.

**Como conferir os três de uma vez:**

```sql
with tela as (select unnest(array['enviar_email','esperar','manychat_tag','…']) as tipo)
select t.tipo,
       (select position('''' || t.tipo || '''' in prosrc) > 0
        from pg_proc where proname = 'executar_automacoes')   as o_motor_conhece,
       position('''' || t.tipo || '''' in
         (select pg_get_constraintdef(oid) from pg_constraint
          where conname = 'automacao_passos_tipo_check')) > 0 as a_tabela_aceita
from tela t;
```

Tudo tem que ser `true`. Foi assim que os dois apareceram.

**A lição maior:** conferir na tela que o passo aparece e salva não prova nada. Só montar a
automação inteira e ver o efeito do outro lado — no caso, a tag chegando no ManyChat —
prova que o caminho existe.

---

## 34. Casar telefone pelos últimos dígitos junta gente diferente

**Sintoma:** procurar por um número inventado do DDD 11 devolve uma pessoa real do DDD 21.

**Causa:** o casamento comparava os **10 últimos dígitos**. Em número brasileiro isso
descarta o primeiro dígito do DDD:

```
5521 90000-0000  →  últimos 10 = 1900000000
5511 90000-0000  →  últimos 10 = 1900000000
```

Duas pessoas, dois estados, o mesmo resultado.

**Por que é grave aqui:** o número é a chave que liga a Ressoa ao ManyChat. Um casamento
errado aplica a tag na pessoa errada — e tag no ManyChat dispara mensagem de WhatsApp.
Alguém que não comprou recebe a mensagem de quem comprou.

**Correção:** normalizar os dois lados para a **mesma forma canônica** antes de comparar,
com as mesmas regras que a ponte com o ManyChat usa (`public.normalizar_telefone`). Se as
regras divergirem, a Ressoa passa a achar uma pessoa e o ManyChat outra.

**Como conferir:**

```sql
select public.normalizar_telefone('5521900000000')
    <> public.normalizar_telefone('5511900000000');   -- tem que ser true
```

**A lição:** "pegar só o final do número" parece resolver o problema de formato e cria um
pior. Formato se resolve normalizando, não truncando.

---

## 35. Telefone fixo não ganha o nono dígito

**Sintoma:** um contato com telefone fixo vira um celular que não é dele.

**Causa:** a regra dizia "12 dígitos começando com 55? Então falta o 9 — enfia depois do
DDD". Aplicada a um fixo, `5551 3333-4444` vira `5551 9 3333-4444`, que é um número
diferente e pode ser de outra pessoa.

**Como a numeração brasileira funciona de verdade:**

| | Formato | Primeiro dígito depois do DDD |
|---|---|---|
| Fixo | 55 + DDD + **8** dígitos | 2, 3, 4 ou 5 |
| Celular | 55 + DDD + **9** dígitos | sempre 9 |

Desde **14/02/2017** todo celular do país tem o nono dígito, em todos os DDDs — não
existe exceção regional. Então um número de 12 dígitos ou é fixo (e não tem WhatsApp), ou
é cadastro de celular anterior a 2017.

**Correção:** olhar o primeiro dígito depois do DDD antes de decidir. Na base havia 206
números de 12 dígitos: 185 eram celulares velhos, **21 eram fixos**.

**Por que é grave:** o número é a chave que liga a Ressoa ao ManyChat. Número inventado
aplica tag na pessoa errada, e tag no ManyChat dispara WhatsApp.

**A regra vive em três lugares e os três precisam concordar:**
`public.normalizar_telefone`, `formatarTelefone` na função do ManyChat, e o nó
"Formatar telefone" do n8n. Se divergirem, a Ressoa acha uma pessoa e o ManyChat outra.

```sql
select public.normalizar_telefone('551133334444') is null;   -- fixo: tem que ser true
```
