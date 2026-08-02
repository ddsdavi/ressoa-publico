# -*- coding: utf-8 -*-
"""Exporta todos os dados da conta ActiveCampaign viniicosta011 para JSON + CSV consolidado."""
import json, time, os, csv
import urllib.request, urllib.parse, urllib.error

BASE = "https://SUACONTA.api-us1.com/api/3"
TOKEN = os.environ["AC_API_TOKEN"]
OUT = r"D:\1. CLAUDE DS.DAVI.OFICIAL\ACTIVE DAVI DAMASCENO\activecampaign-export"
os.makedirs(OUT, exist_ok=True)


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


def save(name, data):
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print("salvo %s (%d itens)" % (name, len(data)), flush=True)


def load(name):
    p = os.path.join(OUT, name + ".json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def paginate(resource, key, extra=None, limit=100, label=None):
    label = label or resource
    items, offset, total = [], 0, None
    while True:
        params = {"limit": limit, "offset": offset}
        if extra:
            params.update(extra)
        d = get("/" + resource, params)
        batch = d.get(key, [])
        items.extend(batch)
        if total is None:
            try:
                total = int(d.get("meta", {}).get("total"))
            except (TypeError, ValueError):
                total = None
        offset += limit
        if not batch or len(items) % 2000 < limit:
            print("  %s: %d/%s" % (label, len(items), total), flush=True)
        if not batch or (total is not None and len(items) >= total):
            break
        time.sleep(0.22)
    return items


def paginate_contacts():
    """Paginacao por id_greater (mais confiavel que offset para bases grandes)."""
    items, last_id = [], 0
    while True:
        d = get("/contacts", {"limit": 100, "status": -1, "id_greater": last_id})
        batch = d.get("contacts", [])
        if not batch:
            break
        items.extend(batch)
        last_id = max(int(c["id"]) for c in batch)
        if len(items) % 1000 < 100:
            print("  contacts: %d (ultimo id %d)" % (len(items), last_id), flush=True)
        time.sleep(0.22)
    return items


summary = {}
print("== inicio da exportacao ==", flush=True)

# 1) contatos
contacts = paginate_contacts()
save("contacts", contacts)
summary["contacts"] = len(contacts)

# 2) recursos simples
for res, key in [("lists", "lists"), ("tags", "tags"), ("fields", "fields"),
                 ("automations", "automations"), ("campaigns", "campaigns"),
                 ("messages", "messages")]:
    try:
        data = paginate(res, key)
        save(res, data)
        summary[res] = len(data)
    except Exception as e:
        print("  PULADO %s: %s" % (res, e), flush=True)
        summary[res] = "erro: %s" % e

# 3) valores de campos personalizados
try:
    field_values = paginate("fieldValues", "fieldValues")
    save("fieldValues", field_values)
    summary["fieldValues"] = len(field_values)
except Exception as e:
    print("  PULADO fieldValues: %s" % e, flush=True)
    field_values = []
    summary["fieldValues"] = "erro: %s" % e

# 4) associacoes contato-tag
contact_tags = []
try:
    contact_tags = paginate("contactTags", "contactTags")
except Exception as e:
    print("  contactTags global falhou (%s); buscando por tag" % e, flush=True)
    for t in load("tags"):
        tid = t["id"]
        try:
            members = paginate("contacts", "contacts",
                               extra={"tagid": tid, "status": -1},
                               label="tag %s (%s)" % (tid, t.get("tag", "")))
            for c in members:
                contact_tags.append({"contact": c["id"], "tag": tid})
        except Exception as e2:
            print("  PULADA tag %s: %s" % (tid, e2), flush=True)
save("contactTags", contact_tags)
summary["contactTags"] = len(contact_tags)

# 5) associacoes contato-lista, com status por lista
#    status: 0=nao confirmado, 1=ativo, 2=descadastrado, 3=bounce
list_members = []
for l in load("lists"):
    lid = l["id"]
    for st in (0, 1, 2, 3):
        try:
            members = paginate("contacts", "contacts",
                               extra={"listid": lid, "status": st},
                               label="lista %s status %d" % (lid, st))
            for c in members:
                list_members.append({"contact": c["id"], "list": lid, "status": st})
        except Exception as e:
            print("  PULADA lista %s status %d: %s" % (lid, st, e), flush=True)
save("contactLists", list_members)
summary["contactLists"] = len(list_members)

# 6) CSV consolidado
print("montando CSV consolidado...", flush=True)
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
    for c in contacts:
        cid = str(c["id"])
        fv = fv_by_contact.get(cid, {})
        w.writerow([
            cid, c.get("email"), c.get("firstName"), c.get("lastName"), c.get("phone"),
            c.get("created_utc_timestamp"), c.get("updated_utc_timestamp"),
            "; ".join(sorted(tags_by_contact.get(cid, []))),
            "; ".join(sorted(lists_by_contact.get(cid, []))),
        ] + [fv.get(k, "") for k in custom_cols])
print("CSV salvo em %s" % csv_path, flush=True)

with open(os.path.join(OUT, "_resumo.json"), "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)
print("== fim da exportacao ==", flush=True)
print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
