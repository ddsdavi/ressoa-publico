-- =====================================================================
-- MOTOR v10 — campos próprios funcionando dentro do e-mail.
--
-- A tela de Campos mostra a variável de cada campo. Sem isto ela seria
-- uma promessa vazia: a pessoa copiaria {{campo.16LC-UTM-SOURCE}} para o
-- e-mail e o texto sairia literal, com as chaves e tudo.
--
-- Duas formas aceitas, de propósito:
--   {{campo.NOME-DO-CAMPO}}  — a nossa
--   %UTMSOURCE%              — a do ActiveCampaign, para os 100 e-mails
--                              legados continuarem funcionando sem reescrita
--
-- Campo sem valor naquele contato vira string vazia, nunca aparece cru no
-- e-mail. Mandar "%UTMSOURCE%" para 12 mil pessoas seria constrangedor.
-- =====================================================================
begin;

create or replace function public.personalizar(p_texto text, p_lead uuid) returns text
language plpgsql stable as $$
declare
  v_texto text := coalesce(p_texto, '');
  v_lead record;
  v_dados jsonb;
  v_c record;
begin
  if v_texto = '' or p_lead is null then
    return v_texto;
  end if;

  select * into v_lead from public.tabela_1_leads where lead_id = p_lead;
  if not found then
    return v_texto;
  end if;

  -- ---- básicos: os nossos e os herdados do ActiveCampaign ----
  v_texto := replace(v_texto, '{{nome}}', coalesce(split_part(v_lead.nome, ' ', 1), ''));
  v_texto := replace(v_texto, '{{nome_completo}}', coalesce(v_lead.nome, ''));
  v_texto := replace(v_texto, '{{email}}', coalesce(v_lead.email, ''));
  v_texto := replace(v_texto, '{{whatsapp}}', coalesce(v_lead.whatsapp, ''));
  v_texto := replace(v_texto, '%FIRSTNAME%', coalesce(split_part(v_lead.nome, ' ', 1), ''));
  v_texto := replace(v_texto, '%FULLNAME%', coalesce(v_lead.nome, ''));
  v_texto := replace(v_texto, '%LASTNAME%',
    coalesce(nullif(regexp_replace(coalesce(v_lead.nome, ''), '^\S+\s*', ''), ''), ''));
  v_texto := replace(v_texto, '%EMAIL%', coalesce(v_lead.email, ''));
  v_texto := replace(v_texto, '%PHONE%', coalesce(v_lead.whatsapp, ''));

  -- ---- campos próprios ----
  -- Só percorre os campos cadastrados: varrer o JSON do lead deixaria de
  -- fora quem não tem valor, e aí a variável sairia crua no e-mail.
  select dados into v_dados from public.lead_atributos where lead_fk = p_lead;
  v_dados := coalesce(v_dados, '{}'::jsonb);

  for v_c in select chave, perstag from public.campos_personalizados loop
    v_texto := replace(v_texto, '{{campo.' || v_c.chave || '}}',
                       coalesce(v_dados ->> v_c.chave, ''));
    if coalesce(v_c.perstag, '') <> '' then
      v_texto := replace(v_texto, '%' || v_c.perstag || '%',
                         coalesce(v_dados ->> v_c.chave, ''));
    end if;
  end loop;

  return v_texto;
end $$;

commit;

-- prova: um lead que tem campo preenchido, com as duas formas de escrita
with alvo as (
  select la.lead_fk, (select chave from public.campos_personalizados
                      where chave = (select j.key from jsonb_each(la.dados) j limit 1)) as chave,
         (select j.value #>> '{}' from jsonb_each(la.dados) j limit 1) as valor
  from public.lead_atributos la
  where la.dados <> '{}'::jsonb
  limit 1
)
select chave,
       valor as valor_no_banco,
       public.personalizar('[{{campo.' || chave || '}}]', lead_fk) as saiu_no_email,
       public.personalizar('Oi {{nome}}', lead_fk) as saudacao
from alvo;
