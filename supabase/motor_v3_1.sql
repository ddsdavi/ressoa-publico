-- MOTOR v3.1 — personalizar() também traduz as tags do ActiveCampaign
-- (%FIRSTNAME%, %FULLNAME%, %LASTNAME%, %EMAIL%) presentes nos 100 e-mails legados.
create or replace function public.personalizar(p_texto text, p_lead uuid) returns text
language sql stable as $$
  select replace(replace(replace(replace(replace(replace(replace(coalesce(p_texto,''),
           '{{nome}}', coalesce(split_part(l.nome, ' ', 1), '')),
           '{{nome_completo}}', coalesce(l.nome, '')),
           '{{email}}', coalesce(l.email, '')),
           '%FIRSTNAME%', coalesce(split_part(l.nome, ' ', 1), '')),
           '%FULLNAME%', coalesce(l.nome, '')),
           '%LASTNAME%', coalesce(nullif(regexp_replace(coalesce(l.nome,''), '^\S+\s*', ''), ''), '')),
           '%EMAIL%', coalesce(l.email, ''))
  from public.tabela_1_leads l where l.lead_id = p_lead
$$;

select public.personalizar('Oi %FULLNAME% ({{nome}}) - %EMAIL%', 'f676fb0a-e083-41d4-bbcb-faf9d4864bcb') as teste;
