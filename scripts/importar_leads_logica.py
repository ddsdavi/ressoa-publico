# -*- coding: utf-8 -*-
"""Importa a base do ActiveCampaign para o Supabase (SEU-PROJETO) seguindo
a logica do modelo de dados da operacao:

  tabela_1_leads         <- 1 linha por PESSOA (merge por whatsapp normalizado; sem
                            whatsapp, identidade = e-mail). WhatsApp vira opcional.
  tabela_2_participacoes <- listas-evento (exceto Master Contact List) + todas as
                            tags, com evento_origem = nome exato e data real da tag.
  tabela_4_alunos        <- fica intacta (compras reais virao do checkout).
  ac_*                   <- arquivo bruto do AC: contatos, status por lista,
                            campos personalizados, campanhas, mensagens, automacoes.
"""
import os
import json, time, os, re, uuid
import urllib.request, urllib.error

REF = os.environ.get("SUPABASE_PROJECT_REF", "SEU-PROJETO")
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]        # veja .env.example
API = "https://api.supabase.com/v1/projects/%s/database/query" % REF
OUT = r"D:\1. CLAUDE DS.DAVI.OFICIAL\ACTIVE DAVI DAMASCENO\activecampaign-export"
MASTER_LIST_ID = "3"


def run_sql(query):
    body = json.dumps({"query": query}).encode("utf-8")
    last_err = None
    for attempt in range(6):
        req = urllib.request.Request(API, data=body, method="POST", headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
            # o Cloudflare da api.supabase.com bloqueia o UA padrao do urllib (erro 1010)
            "User-Agent": "supabase-import/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:800]
            if e.code in (400, 401, 404):
                raise RuntimeError("HTTP %d: %s" % (e.code, detail))
            last_err = "HTTP %d: %s" % (e.code, detail)
        except Exception as e:
            last_err = str(e)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("falhou apos retries: %s" % last_err)


def load(name):
    with open(os.path.join(OUT, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def dollar_quote(payload):
    tag = "$ac_json$"
    n = 0
    while tag in payload:
        n += 1
        tag = "$ac_json%d$" % n
    return tag + payload + tag


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


def norm_phone(p):
    d = re.sub(r"\D", "", p or "")
    d = d.lstrip("0")
    if not d:
        return None
    if len(d) in (10, 11):
        d = "55" + d
    if len(d) < 10:
        return None
    # numero fake: todos os digitos iguais depois do DDI
    resto = d[2:] if d.startswith("55") else d
    if len(set(resto)) <= 1:
        return None
    return d


# ================= FASE 1: migracao de estrutura =================
print("== fase 1: migracao de estrutura ==", flush=True)
run_sql("""
begin;
alter table public.tabela_1_leads alter column whatsapp drop not null;
create unique index if not exists tabela_1_leads_email_lower_key
  on public.tabela_1_leads (lower(email)) where email is not null;

create table if not exists public.ac_contacts (
  id bigint primary key,
  lead_fk uuid references public.tabela_1_leads(lead_id) on delete set null,
  email text,
  first_name text,
  last_name text,
  phone text,
  whatsapp_normalizado text,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb not null
);
comment on table public.ac_contacts is 'Arquivo bruto dos contatos do ActiveCampaign (viniicosta011), exportado em 2026-08-01. lead_fk aponta para o lead unificado na tabela_1_leads.';
create index if not exists ac_contacts_lead_idx on public.ac_contacts (lead_fk);

create table if not exists public.ac_lists (id bigint primary key, name text, raw jsonb not null);
create table if not exists public.ac_tags (id bigint primary key, tag text, tag_type text, raw jsonb not null);
create table if not exists public.ac_fields (id bigint primary key, title text, type text, perstag text, raw jsonb not null);
create table if not exists public.ac_field_values (
  id bigint primary key,
  contact_id bigint,
  field_id bigint,
  value text
);
create index if not exists ac_field_values_contact_idx on public.ac_field_values (contact_id);
create table if not exists public.ac_contact_tags (
  contact_id bigint,
  tag_id bigint,
  applied_at timestamptz,
  primary key (contact_id, tag_id)
);
create index if not exists ac_contact_tags_tag_idx on public.ac_contact_tags (tag_id);
create table if not exists public.ac_contact_lists (
  contact_id bigint,
  list_id bigint,
  status int,
  primary key (contact_id, list_id)
);
comment on column public.ac_contact_lists.status is '0=nao confirmado, 1=ativo, 2=descadastrado, 3=bounce';
create index if not exists ac_contact_lists_list_idx on public.ac_contact_lists (list_id);
create table if not exists public.ac_automations (id bigint primary key, name text, raw jsonb not null);
create table if not exists public.ac_campaigns (id bigint primary key, name text, raw jsonb not null);
create table if not exists public.ac_messages (id bigint primary key, subject text, raw jsonb not null);
alter table public.ac_contacts enable row level security;
alter table public.ac_lists enable row level security;
alter table public.ac_tags enable row level security;
alter table public.ac_fields enable row level security;
alter table public.ac_field_values enable row level security;
alter table public.ac_contact_tags enable row level security;
alter table public.ac_contact_lists enable row level security;
alter table public.ac_automations enable row level security;
alter table public.ac_campaigns enable row level security;
alter table public.ac_messages enable row level security;
commit;
""")
print("estrutura ok.", flush=True)
time.sleep(1.05)

# ================= FASE 2: transformacao (merge) =================
print("== fase 2: merge de contatos -> leads ==", flush=True)
contacts = load("contacts")

for c in contacts:
    c["_wa"] = norm_phone(c.get("phone"))
    c["_email"] = (c.get("email") or "").strip()
    c["_upd"] = c.get("updated_utc_timestamp") or c.get("created_utc_timestamp") or ""
    c["_crt"] = c.get("created_utc_timestamp") or ""

# agrupa por whatsapp; sem whatsapp -> grupo proprio por email
grupos = {}
for c in contacts:
    key = ("wa", c["_wa"]) if c["_wa"] else ("em", c["_email"].lower())
    grupos.setdefault(key, []).append(c)

# merge por email (case-insensitive) entre grupos de whatsapp diferentes nao e
# necessario: emails do AC sao todos unicos; so trata colisao lower() defensivamente
por_email_lower = {}
leads = []
for key, membros in grupos.items():
    membros.sort(key=lambda c: c["_upd"], reverse=True)
    canonico = membros[0]
    email = canonico["_email"] or next((m["_email"] for m in membros if m["_email"]), "")
    el = email.lower()
    if el and el in por_email_lower:
        # colisao case-insensitive: funde no lead ja existente
        lead = por_email_lower[el]
        lead["ac_ids"].extend(str(m["id"]) for m in membros)
        if not lead["whatsapp"] and key[0] == "wa":
            lead["whatsapp"] = key[1]
        continue
    nome = " ".join(x for x in [(canonico.get("firstName") or "").strip(),
                                (canonico.get("lastName") or "").strip()] if x) or None
    lead = {
        "lead_id": str(uuid.uuid4()),
        "whatsapp": key[1] if key[0] == "wa" else None,
        "email": email or None,
        "nome": nome,
        "created_at": min(m["_crt"] for m in membros if m["_crt"]) or None,
        "ac_ids": [str(m["id"]) for m in membros],
    }
    leads.append(lead)
    if el:
        por_email_lower[el] = lead

print("contatos AC: %d -> leads unificados: %d" % (len(contacts), len(leads)), flush=True)
print("  com whatsapp: %d | so email: %d" % (
    sum(1 for l in leads if l["whatsapp"]), sum(1 for l in leads if not l["whatsapp"])), flush=True)

# concilia com leads ja existentes no banco (ex.: lead de teste)
existentes = run_sql("select lead_id, whatsapp, lower(email) as el from public.tabela_1_leads") or []
ex_wa = {e["whatsapp"]: e["lead_id"] for e in existentes if e.get("whatsapp")}
ex_em = {e["el"]: e["lead_id"] for e in existentes if e.get("el")}
novos = []
for l in leads:
    ja = (l["whatsapp"] and ex_wa.get(l["whatsapp"])) or (l["email"] and ex_em.get(l["email"].lower()))
    if ja:
        l["lead_id"] = ja  # reusa o lead existente; nao insere
    else:
        novos.append(l)
print("leads ja existentes no banco reaproveitados: %d | a inserir: %d" % (len(leads) - len(novos), len(novos)), flush=True)

# ================= FASE 3: insercao de leads =================
print("== fase 3: inserindo leads ==", flush=True)
rows = [{"lead_id": l["lead_id"], "whatsapp": l["whatsapp"], "email": l["email"],
         "nome": l["nome"], "created_at": l["created_at"]} for l in novos]
insert_batches("tabela_1_leads", rows, 400, """
insert into public.tabela_1_leads (lead_id, whatsapp, email, nome, created_at)
select (x->>'lead_id')::uuid, x->>'whatsapp', x->>'email', x->>'nome',
       coalesce(nullif(x->>'created_at','')::timestamptz, now())
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

# reconsulta o mapa real (garantia de FK correta mesmo se algo foi pulado)
db_leads = run_sql("select lead_id, whatsapp, lower(email) as el from public.tabela_1_leads") or []
mapa_wa = {e["whatsapp"]: e["lead_id"] for e in db_leads if e.get("whatsapp")}
mapa_em = {e["el"]: e["lead_id"] for e in db_leads if e.get("el")}
contato_para_lead = {}
sem_lead = 0
for l in leads:
    lid = (l["whatsapp"] and mapa_wa.get(l["whatsapp"])) or (l["email"] and mapa_em.get(l["email"].lower()))
    if not lid:
        sem_lead += len(l["ac_ids"])
        continue
    for cid in l["ac_ids"]:
        contato_para_lead[cid] = lid
print("leads no banco: %d | contatos mapeados: %d | sem lead (anomalia): %d" % (
    len(db_leads), len(contato_para_lead), sem_lead), flush=True)

# ================= FASE 4: participacoes =================
print("== fase 4: participacoes ==", flush=True)
tag_nome = {str(t["id"]): t.get("tag") or str(t["id"]) for t in load("tags")}
lista_nome = {str(l["id"]): l.get("name") or str(l["id"]) for l in load("lists")}

part = {}  # (lead_id, evento) -> data mais antiga
for ct in load("contactTags"):
    lid = contato_para_lead.get(str(ct.get("contact")))
    if not lid:
        continue
    evento = tag_nome.get(str(ct.get("tag")))
    if not evento:
        continue
    dt = ct.get("cdate") or None
    k = (lid, evento)
    if k not in part or (dt and (part[k] is None or dt < part[k])):
        part[k] = dt

for lm in load("contactLists"):
    if str(lm.get("list")) == MASTER_LIST_ID:
        continue
    lid = contato_para_lead.get(str(lm.get("contact")))
    if not lid:
        continue
    evento = lista_nome.get(str(lm.get("list")))
    if not evento:
        continue
    k = (lid, evento)
    if k not in part:
        part[k] = None

rows = [{"lead_fk": k[0], "evento_origem": k[1], "created_at": v} for k, v in part.items()]
print("participacoes unicas (lead x evento): %d" % len(rows), flush=True)
insert_batches("tabela_2_participacoes", rows, 1000, """
insert into public.tabela_2_participacoes (lead_fk, evento_origem, created_at)
select (x->>'lead_fk')::uuid, x->>'evento_origem',
       coalesce(nullif(x->>'created_at','')::timestamptz, now())
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

# ================= FASE 5: arquivo bruto ac_* =================
print("== fase 5: arquivo bruto ac_* ==", flush=True)
rows = []
for c in contacts:
    rows.append({"id": c["id"], "lead_fk": contato_para_lead.get(str(c["id"])),
                 "email": c.get("email"), "first_name": c.get("firstName"),
                 "last_name": c.get("lastName"), "phone": c.get("phone"),
                 "wa": c.get("_wa"), "created": c.get("created_utc_timestamp"),
                 "updated": c.get("updated_utc_timestamp")})
insert_batches("ac_contacts", rows, 500, """
insert into public.ac_contacts (id, lead_fk, email, first_name, last_name, phone, whatsapp_normalizado, created_at, updated_at, raw)
select (x->>'id')::bigint, nullif(x->>'lead_fk','')::uuid, x->>'email', x->>'first_name', x->>'last_name',
       x->>'phone', x->>'wa',
       nullif(x->>'created','')::timestamptz, nullif(x->>'updated','')::timestamptz, x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

insert_batches("ac_lists", load("lists"), 50, """
insert into public.ac_lists (id, name, raw)
select (x->>'id')::bigint, x->>'name', x from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")
insert_batches("ac_tags", load("tags"), 100, """
insert into public.ac_tags (id, tag, tag_type, raw)
select (x->>'id')::bigint, x->>'tag', x->>'tagType', x from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")
insert_batches("ac_fields", load("fields"), 50, """
insert into public.ac_fields (id, title, type, perstag, raw)
select (x->>'id')::bigint, x->>'title', x->>'type', x->>'perstag', x from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

fv = [{"id": v.get("id"), "contact": v.get("contact"), "field": v.get("field"), "value": v.get("value")}
      for v in load("fieldValues")]
insert_batches("ac_field_values", fv, 800, """
insert into public.ac_field_values (id, contact_id, field_id, value)
select (x->>'id')::bigint, (x->>'contact')::bigint, (x->>'field')::bigint, x->>'value'
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

seen = set()
ct_rows = []
for ct in load("contactTags"):
    key = (str(ct.get("contact")), str(ct.get("tag")))
    if key in seen:
        continue
    seen.add(key)
    ct_rows.append({"contact": key[0], "tag": key[1], "cdate": ct.get("cdate")})
insert_batches("ac_contact_tags", ct_rows, 1200, """
insert into public.ac_contact_tags (contact_id, tag_id, applied_at)
select (x->>'contact')::bigint, (x->>'tag')::bigint, nullif(x->>'cdate','')::timestamptz
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

cl = {}
for lm in load("contactLists"):
    cl[(str(lm.get("contact")), str(lm.get("list")))] = lm.get("status")
cl_rows = [{"contact": k[0], "list": k[1], "status": v} for k, v in cl.items()]
insert_batches("ac_contact_lists", cl_rows, 1500, """
insert into public.ac_contact_lists (contact_id, list_id, status)
select (x->>'contact')::bigint, (x->>'list')::bigint, (x->>'status')::int
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

insert_batches("ac_automations", load("automations"), 50, """
insert into public.ac_automations (id, name, raw)
select (x->>'id')::bigint, x->>'name', x from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")
insert_batches("ac_campaigns", load("campaigns"), 20, """
insert into public.ac_campaigns (id, name, raw)
select (x->>'id')::bigint, x->>'name', x from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")
insert_batches("ac_messages", load("messages"), 8, """
insert into public.ac_messages (id, subject, raw)
select (x->>'id')::bigint, x->>'subject', x from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

# ================= FASE 6: verificacao =================
print("== fase 6: verificacao ==", flush=True)
counts = run_sql("""
select 'tabela_1_leads' t, count(*) n from public.tabela_1_leads
union all select 'tabela_1_leads (sem whatsapp)', count(*) from public.tabela_1_leads where whatsapp is null
union all select 'tabela_2_participacoes', count(*) from public.tabela_2_participacoes
union all select 'ac_contacts', count(*) from public.ac_contacts
union all select 'ac_contacts (com lead_fk)', count(*) from public.ac_contacts where lead_fk is not null
union all select 'ac_field_values', count(*) from public.ac_field_values
union all select 'ac_contact_tags', count(*) from public.ac_contact_tags
union all select 'ac_contact_lists', count(*) from public.ac_contact_lists
union all select 'ac_lists', count(*) from public.ac_lists
union all select 'ac_tags', count(*) from public.ac_tags
union all select 'ac_fields', count(*) from public.ac_fields
union all select 'ac_automations', count(*) from public.ac_automations
union all select 'ac_campaigns', count(*) from public.ac_campaigns
union all select 'ac_messages', count(*) from public.ac_messages
order by 1;
""")
print(json.dumps(counts, ensure_ascii=False, indent=2), flush=True)

top = run_sql("""
select evento_origem, count(*) as leads
from public.tabela_2_participacoes
group by 1 order by 2 desc limit 15;
""")
print("top eventos por participacao:", flush=True)
print(json.dumps(top, ensure_ascii=False, indent=2), flush=True)
print("== fim ==", flush=True)
