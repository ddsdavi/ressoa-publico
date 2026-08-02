# -*- coding: utf-8 -*-
"""O endpoint global /contactTags do ActiveCampaign tem paginacao instavel
(repetiu itens e pulou ~4.462 associacoes). Este script refaz a busca TAG POR TAG
(/contacts?tagid=X, subconjuntos pequenos e estaveis), completa ac_contact_tags e
tabela_2_participacoes no Supabase, e verifica contra os contadores oficiais."""
import os
import json, time, os
import urllib.request, urllib.parse, urllib.error

AC_BASE = "https://SUACONTA.api-us1.com/api/3"
AC_TOKEN = os.environ["AC_API_TOKEN"]
SB_REF = os.environ["SUPABASE_PROJECT_REF"]       # veja .env.example
API = f"https://api.supabase.com/v1/projects/{REF}/database/query"
SB_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]        # veja .env.example
OUT = r"D:\1. CLAUDE DS.DAVI.OFICIAL\ACTIVE DAVI DAMASCENO\activecampaign-export"


def http_json(url, data=None, headers=None):
    last_err = None
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                     headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            if e.code in (400, 401, 404):
                raise RuntimeError("HTTP %d: %s" % (e.code, detail))
            last_err = "HTTP %d: %s" % (e.code, detail)
        except Exception as e:
            last_err = str(e)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("falhou: %s (%s)" % (url, last_err))


def ac_get(path, params):
    url = AC_BASE + path + "?" + urllib.parse.urlencode(params)
    return http_json(url, headers={"Api-Token": AC_TOKEN, "User-Agent": "ac-export/1.0"})


def run_sql(query):
    body = json.dumps({"query": query}).encode("utf-8")
    return http_json(SB_API, data=body, headers={
        "Authorization": "Bearer " + SB_TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "supabase-import/1.0",
    })


def dollar_quote(payload):
    tag = "$ac_json$"
    n = 0
    while tag in payload:
        n += 1
        tag = "$ac_json%d$" % n
    return tag + payload + tag


def load(name):
    with open(os.path.join(OUT, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


# ---- 1) refaz associacoes tag por tag ----
tags = load("tags")
print("== buscando membros de %d tags no AC ==" % len(tags), flush=True)
membros_por_tag = {}
for t in tags:
    tid = str(t["id"])
    oficial = int(t.get("subscriber_count") or 0)
    ids = set()
    offset = 0
    while True:
        d = ac_get("/contacts", {"limit": 100, "offset": offset, "tagid": tid, "status": -1})
        batch = d.get("contacts", [])
        for c in batch:
            ids.add(str(c["id"]))
        if not batch or len(batch) < 100:
            break
        offset += 100
        time.sleep(0.22)
    membros_por_tag[tid] = sorted(ids, key=int)
    flag = "OK" if len(ids) == oficial else "DIF"
    print("  tag %s %-45s oficial=%d obtido=%d [%s]" % (tid, (t.get("tag") or "")[:45], oficial, len(ids), flag), flush=True)
    time.sleep(0.22)

with open(os.path.join(OUT, "contactTags_membros.json"), "w", encoding="utf-8") as f:
    json.dump(membros_por_tag, f, ensure_ascii=False)
total_assoc = sum(len(v) for v in membros_por_tag.values())
print("associacoes totais (tag x contato): %d" % total_assoc, flush=True)

# ---- 2) estado atual no banco ----
print("== consultando estado atual no Supabase ==", flush=True)
db_pairs = run_sql("select contact_id, tag_id from public.ac_contact_tags") or []
existentes = set((str(p["contact_id"]), str(p["tag_id"])) for p in db_pairs)
mapa_lead = run_sql("select id, lead_fk from public.ac_contacts") or []
contato_para_lead = {str(m["id"]): m["lead_fk"] for m in mapa_lead if m.get("lead_fk")}
tag_nome = {str(t["id"]): t.get("tag") or str(t["id"]) for t in tags}
print("pares no banco: %d | contatos mapeados: %d" % (len(existentes), len(contato_para_lead)), flush=True)

faltantes = []
part_novas = set()
for tid, membros in membros_por_tag.items():
    for cid in membros:
        if (cid, tid) not in existentes:
            faltantes.append({"contact": cid, "tag": tid})
            lid = contato_para_lead.get(cid)
            if lid:
                part_novas.add((lid, tag_nome[tid]))
print("associacoes faltantes a inserir: %d | participacoes novas: %d" % (len(faltantes), len(part_novas)), flush=True)

# ---- 3) insere faltantes ----
def insert_batches(label, rows, batch, sql_template):
    total = len(rows)
    done = 0
    for i in range(0, total, batch):
        chunk = rows[i:i + batch]
        payload = json.dumps(chunk, ensure_ascii=False)
        run_sql(sql_template.format(json=dollar_quote(payload) + "::jsonb"))
        done += len(chunk)
        print("  %s: %d/%d" % (label, done, total), flush=True)
        time.sleep(1.05)

insert_batches("ac_contact_tags", faltantes, 1500, """
insert into public.ac_contact_tags (contact_id, tag_id)
select (x->>'contact')::bigint, (x->>'tag')::bigint
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

rows = [{"lead_fk": k[0], "evento_origem": k[1]} for k in part_novas]
insert_batches("tabela_2_participacoes", rows, 1000, """
insert into public.tabela_2_participacoes (lead_fk, evento_origem)
select (x->>'lead_fk')::uuid, x->>'evento_origem'
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

# ---- 4) verificacao final: banco vs oficial, tag a tag ----
print("== verificacao final ==", flush=True)
db_por_tag = run_sql("select tag_id, count(*) n from public.ac_contact_tags group by 1") or []
db_counts = {str(r["tag_id"]): r["n"] for r in db_por_tag}
divergencias = 0
for t in tags:
    tid = str(t["id"])
    oficial = int(t.get("subscriber_count") or 0)
    banco = db_counts.get(tid, 0)
    if banco < oficial:
        divergencias += 1
        print("  AINDA FALTA tag %s %s: oficial=%d banco=%d" % (tid, t.get("tag"), oficial, banco), flush=True)
print("tags ainda divergentes (banco < oficial): %d" % divergencias, flush=True)

tot = run_sql("""
select 'ac_contact_tags' t, count(*) n from public.ac_contact_tags
union all select 'tabela_2_participacoes', count(*) from public.tabela_2_participacoes;
""")
print(json.dumps(tot, ensure_ascii=False), flush=True)
print("== fim ==", flush=True)
