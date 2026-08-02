# -*- coding: utf-8 -*-
"""Importa o export do ActiveCampaign para o Supabase (projeto SEU-PROJETO)
via Management API. Tabelas com prefixo ac_ no schema public, RLS ligado sem policies
(mesma postura das demais tabelas: acesso apenas via service role)."""
import os
import json, time, os
import urllib.request, urllib.error

REF = os.environ.get("SUPABASE_PROJECT_REF", "SEU-PROJETO")
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]        # veja .env.example
API = "https://api.supabase.com/v1/projects/%s/database/query" % REF
OUT = r"D:\1. CLAUDE DS.DAVI.OFICIAL\ACTIVE DAVI DAMASCENO\activecampaign-export"


def run_sql(query):
    body = json.dumps({"query": query}).encode("utf-8")
    last_err = None
    for attempt in range(6):
        req = urllib.request.Request(API, data=body, method="POST", headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
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
    """sql_template contem {json} que vira o array jsonb dollar-quoted."""
    total = len(rows)
    done = 0
    for i in range(0, total, batch):
        chunk = rows[i:i + batch]
        payload = json.dumps(chunk, ensure_ascii=False)
        run_sql(sql_template.format(json=dollar_quote(payload) + "::jsonb"))
        done += len(chunk)
        print("  %s: %d/%d" % (label, done, total), flush=True)
        time.sleep(1.05)


print("== criando tabelas ac_* ==", flush=True)
run_sql("""
begin;
create table if not exists public.ac_contacts (
  id bigint primary key,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb not null
);
comment on table public.ac_contacts is 'Contatos exportados do ActiveCampaign (viniicosta011) em 2026-08-01';
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
print("tabelas criadas.", flush=True)
time.sleep(1.05)

# ---------- contatos ----------
contacts = load("contacts")
insert_batches("ac_contacts", contacts, 250, """
insert into public.ac_contacts (id, email, first_name, last_name, phone, created_at, updated_at, raw)
select (x->>'id')::bigint, x->>'email', x->>'firstName', x->>'lastName', x->>'phone',
       nullif(x->>'created_utc_timestamp','')::timestamptz,
       nullif(x->>'updated_utc_timestamp','')::timestamptz, x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

# ---------- listas / tags / campos ----------
insert_batches("ac_lists", load("lists"), 50, """
insert into public.ac_lists (id, name, raw)
select (x->>'id')::bigint, x->>'name', x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

insert_batches("ac_tags", load("tags"), 100, """
insert into public.ac_tags (id, tag, tag_type, raw)
select (x->>'id')::bigint, x->>'tag', x->>'tagType', x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

insert_batches("ac_fields", load("fields"), 50, """
insert into public.ac_fields (id, title, type, perstag, raw)
select (x->>'id')::bigint, x->>'title', x->>'type', x->>'perstag', x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

# ---------- valores de campos ----------
fv = [{"id": v.get("id"), "contact": v.get("contact"), "field": v.get("field"), "value": v.get("value")}
      for v in load("fieldValues")]
insert_batches("ac_field_values", fv, 800, """
insert into public.ac_field_values (id, contact_id, field_id, value)
select (x->>'id')::bigint, (x->>'contact')::bigint, (x->>'field')::bigint, x->>'value'
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

# ---------- contato-tag (dedup) ----------
seen = set()
ct_rows = []
for ct in load("contactTags"):
    key = (str(ct.get("contact")), str(ct.get("tag")))
    if key in seen:
        continue
    seen.add(key)
    ct_rows.append({"contact": key[0], "tag": key[1]})
insert_batches("ac_contact_tags", ct_rows, 1500, """
insert into public.ac_contact_tags (contact_id, tag_id)
select (x->>'contact')::bigint, (x->>'tag')::bigint
from jsonb_array_elements({json}) as x
on conflict do nothing;
""")

# ---------- contato-lista (dedup, ultimo status vence) ----------
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

# ---------- automacoes / campanhas / mensagens ----------
insert_batches("ac_automations", load("automations"), 50, """
insert into public.ac_automations (id, name, raw)
select (x->>'id')::bigint, x->>'name', x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

insert_batches("ac_campaigns", load("campaigns"), 20, """
insert into public.ac_campaigns (id, name, raw)
select (x->>'id')::bigint, x->>'name', x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

insert_batches("ac_messages", load("messages"), 8, """
insert into public.ac_messages (id, subject, raw)
select (x->>'id')::bigint, x->>'subject', x
from jsonb_array_elements({json}) as x
on conflict (id) do nothing;
""")

# ---------- verificacao final ----------
print("== verificacao final ==", flush=True)
counts = run_sql("""
select 'ac_contacts' t, count(*) n from public.ac_contacts
union all select 'ac_lists', count(*) from public.ac_lists
union all select 'ac_tags', count(*) from public.ac_tags
union all select 'ac_fields', count(*) from public.ac_fields
union all select 'ac_field_values', count(*) from public.ac_field_values
union all select 'ac_contact_tags', count(*) from public.ac_contact_tags
union all select 'ac_contact_lists', count(*) from public.ac_contact_lists
union all select 'ac_automations', count(*) from public.ac_automations
union all select 'ac_campaigns', count(*) from public.ac_campaigns
union all select 'ac_messages', count(*) from public.ac_messages
order by 1;
""")
print(json.dumps(counts, ensure_ascii=False, indent=2), flush=True)
print("== fim da importacao ==", flush=True)
