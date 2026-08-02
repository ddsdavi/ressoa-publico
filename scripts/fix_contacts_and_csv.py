# -*- coding: utf-8 -*-
"""Refaz a busca de contatos via paginacao por offset (id_greater retorna ordem
arbitraria no ActiveCampaign) e reconstroi o CSV consolidado a partir dos JSONs."""
import json, time, os, csv
import urllib.request, urllib.parse, urllib.error

BASE = "https://SUACONTA.api-us1.com/api/3"
TOKEN = os.environ["AC_API_TOKEN"]
OUT = r"D:\1. CLAUDE DS.DAVI.OFICIAL\ACTIVE DAVI DAMASCENO\activecampaign-export"


def get(path, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"Api-Token": TOKEN})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (400, 402, 403, 404):
                raise
            last_err = e
        except Exception as e:
            last_err = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError("falhou apos retries: %s (%s)" % (url, last_err))


def load(name):
    p = os.path.join(OUT, name + ".json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f)


print("== refazendo contatos por offset ==", flush=True)
by_id = {}
offset, total = 0, None
while True:
    d = get("/contacts", {"limit": 100, "offset": offset, "status": -1})
    batch = d.get("contacts", [])
    if total is None:
        try:
            total = int(d.get("meta", {}).get("total"))
        except (TypeError, ValueError):
            total = None
    for c in batch:
        by_id[str(c["id"])] = c
    offset += 100
    if offset % 1000 == 0 or not batch:
        print("  contatos unicos: %d/%s (offset %d)" % (len(by_id), total, offset), flush=True)
    if not batch or (total is not None and offset >= total):
        break
    time.sleep(0.22)

contacts = list(by_id.values())
with open(os.path.join(OUT, "contacts.json"), "w", encoding="utf-8") as f:
    json.dump(contacts, f, ensure_ascii=False)
print("salvo contacts (%d itens)" % len(contacts), flush=True)

# ---- reconstroi CSV consolidado ----
print("montando CSV consolidado...", flush=True)
field_values = load("fieldValues")
contact_tags = load("contactTags")
list_members = load("contactLists")
field_title = {str(f["id"]): f["title"] for f in load("fields")}
tag_title = {str(t["id"]): t.get("tag", str(t["id"])) for t in load("tags")}
list_name = {str(l["id"]): l.get("name", str(l["id"])) for l in load("lists")}
status_label = {0: "nao_confirmado", 1: "ativo", 2: "descadastrado", 3: "bounce"}

fv_by_contact = {}
for v in field_values:
    cid = str(v.get("contact"))
    fv_by_contact.setdefault(cid, {})[field_title.get(str(v.get("field")), "campo_%s" % v.get("field"))] = v.get("value")

tags_by_contact = {}
for ct in contact_tags:
    tags_by_contact.setdefault(str(ct.get("contact")), []).append(tag_title.get(str(ct.get("tag")), str(ct.get("tag"))))

lists_by_contact = {}
for lm in list_members:
    cid = str(lm.get("contact"))
    lists_by_contact.setdefault(cid, []).append(
        "%s (%s)" % (list_name.get(str(lm.get("list")), lm.get("list")), status_label.get(lm.get("status"), lm.get("status"))))

custom_cols = sorted({k for d in fv_by_contact.values() for k in d})
cols = ["id", "email", "first_name", "last_name", "phone", "criado_em", "atualizado_em", "tags", "listas"] + custom_cols

csv_path = os.path.join(OUT, "contacts_consolidado.csv")
with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(cols)
    for c in sorted(contacts, key=lambda x: int(x["id"])):
        cid = str(c["id"])
        fv = fv_by_contact.get(cid, {})
        w.writerow([
            cid, c.get("email"), c.get("firstName"), c.get("lastName"), c.get("phone"),
            c.get("created_utc_timestamp"), c.get("updated_utc_timestamp"),
            "; ".join(sorted(tags_by_contact.get(cid, []))),
            "; ".join(sorted(lists_by_contact.get(cid, []))),
        ] + [fv.get(k, "") for k in custom_cols])
print("CSV salvo em %s" % csv_path, flush=True)

resumo = {}
if os.path.exists(os.path.join(OUT, "_resumo.json")):
    with open(os.path.join(OUT, "_resumo.json"), encoding="utf-8") as f:
        resumo = json.load(f)
resumo["contacts"] = len(contacts)
with open(os.path.join(OUT, "_resumo.json"), "w", encoding="utf-8") as f:
    json.dump(resumo, f, ensure_ascii=False, indent=2)
print("== fim ==", flush=True)
