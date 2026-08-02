# Migrar do ActiveCampaign

Trazer contatos, listas, tags, campos, e-mails e automações. Foi assim que os N
contatos da a dona da conta viraram N leads aqui.

> ⚠️ **O ActiveCampaign nunca é alterado.** Todo o processo é somente leitura lá.

## 1. Pegue a chave da API
No AC: **Configurações → Desenvolvedor** → copie a *URL* e a *Chave*.
Ponha no `.env` (`AC_API_URL`, `AC_API_TOKEN`).

## 2. Exporte tudo
```bash
python scripts/export_activecampaign.py     # contatos, listas, tags, campos, campanhas…
python scripts/fix_contacts_and_csv.py      # refaz a lista de contatos e monta o CSV
python scripts/recuperar_tags_faltantes.py  # confere tag por tag contra o número oficial
```
O terceiro script **não é opcional**: o endpoint global de tags do AC pula registros
(no nosso caso, 4.462 de N). Ele busca tag a tag e confere com o `subscriber_count`.

Resultado em `activecampaign-export/` — **essa pasta nunca vai para o GitHub** (dados pessoais).

## 3. Importe
```bash
python scripts/import_to_supabase.py     # cria as tabelas ac_* (arquivo bruto)
python scripts/importar_leads_logica.py  # transforma em leads, participações e vínculos
python scripts/criar_plataforma.py       # popula listas, tags, mensagens, supressão, automações
```

### Como os contatos viram leads
- Identidade: **WhatsApp normalizado** (com DDI 55) e, na falta dele, o **e-mail**
- Mesmo WhatsApp = mesma pessoa → vira **um** lead (por isso N → N)
- Números falsos (dígitos repetidos) são descartados
- Cada lista e cada tag do AC vira uma **participação** com a data real
- Quem tem bounce no AC entra direto na **supressão**

## 4. Confira antes de confiar
```sql
select l.nome, count(*) filter (where ll.status = 1) as ativos
from public.listas l left join public.lead_listas ll on ll.lista_fk = l.lista_id
group by l.nome order by ativos desc;
```
Compare com os números do AC. Diferença pequena para menos é esperado (duplicados unidos).
Diferença grande é bug — veja [06-PROBLEMAS-CONHECIDOS.md](06-PROBLEMAS-CONHECIDOS.md).

## 5. Automações
A API do AC **não** exporta o desenho interno das automações — só nome e status.
Abra cada uma na tela do AC, anote gatilho e passos, e recrie em **Automações**.
As 19 da a dona da conta estão registradas em `blueprint/PLANO-ACTIVE-PROPRIO.md`.

## 6. Desligar o AC — só no fim
Rode os dois em paralelo por 1 a 2 semanas, compare aberturas e cliques, e só então cancele.
Enquanto isso, mantenha a chave-geral de webhooks **desligada** para não duplicar disparo.
