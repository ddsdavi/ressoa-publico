-- =====================================================================
-- ATRIBUIÇÃO — de qual anúncio veio cada venda.
--
-- A Hotmart manda a origem da venda em dois campos comprimidos:
--
--   xcod : um JSON dentro de uma string
--          {"vsrc":"paid_metaads","url":"…","r":"instagram.com/","vid":"…"}
--   sck  : pares separados por barra vertical
--          m=paid|s=ig|utm_id=…|co=…
--
-- Guardados assim, são inúteis para segmentar: o construtor compara o
-- campo inteiro, não um pedaço de dentro dele. Aqui eles viram campos
-- separados — e "quem comprou vindo de anúncio pago do Instagram" passa
-- a ser dois cliques.
-- =====================================================================
begin;

create or replace function public.extrair_atribuicao(p_dados jsonb)
returns jsonb
language plpgsql immutable as $$
declare
  v_x jsonb;
  v_out jsonb := '{}'::jsonb;
  v_par text;
  v_ch text;
  v_vl text;
begin
  -- ---- xcod: JSON dentro de string ----
  begin
    v_x := (p_dados->>'hotmart_xcod')::jsonb;
  exception when others then
    v_x := null;   -- veio malformado; não é motivo para perder o resto
  end;

  if v_x is not null then
    if coalesce(v_x->>'vsrc','') <> '' then
      v_out := v_out || jsonb_build_object('origem_trafego', v_x->>'vsrc');
    end if;
    if coalesce(v_x->>'r','') <> '' then
      v_out := v_out || jsonb_build_object('veio_de',
        regexp_replace(v_x->>'r', '^https?://|/$', '', 'g'));
    end if;
    if coalesce(v_x->>'url','') <> '' then
      v_out := v_out || jsonb_build_object('pagina_captura',
        regexp_replace(v_x->>'url', '^https?://|/$', '', 'g'));
    end if;
    if coalesce(v_x->>'vid','') <> '' then
      v_out := v_out || jsonb_build_object('anuncio_id', v_x->>'vid');
    end if;
    if coalesce(v_x->>'co','') <> '' then
      v_out := v_out || jsonb_build_object('conjunto_anuncios', v_x->>'co');
    end if;
  end if;

  -- ---- sck: m=paid|s=ig|utm_id=… ----
  if coalesce(p_dados->>'hotmart_sck','') <> '' then
    foreach v_par in array string_to_array(p_dados->>'hotmart_sck', '|') loop
      v_ch := split_part(v_par, '=', 1);
      v_vl := substr(v_par, length(v_ch) + 2);
      if coalesce(v_vl,'') = '' then continue; end if;
      if v_ch = 'm' then
        -- paid / organic, escrito por extenso para ficar legível na tela
        v_out := v_out || jsonb_build_object('midia',
          case v_vl when 'paid' then 'pago' when 'organic' then 'orgânico' else v_vl end);
      elsif v_ch = 's' then
        v_out := v_out || jsonb_build_object('rede',
          case v_vl when 'ig' then 'Instagram' when 'fb' then 'Facebook'
                    when 'yt' then 'YouTube' when 'gg' then 'Google' else v_vl end);
      elsif v_ch = 'utm_id' then
        v_out := v_out || jsonb_build_object('campanha_id', v_vl);
      end if;
    end loop;
  end if;

  return v_out;
end $$;

-- ---- os campos novos ficam cadastrados, com nome legível ----
insert into public.campos_personalizados (chave, rotulo, tipo, grupo)
values
  ('origem_trafego',    'Origem do tráfego',        'texto', 'Atribuição da venda'),
  ('midia',             'Mídia (paga ou orgânica)', 'texto', 'Atribuição da venda'),
  ('rede',              'Rede',                     'texto', 'Atribuição da venda'),
  ('veio_de',           'Veio de (referrer)',       'texto', 'Atribuição da venda'),
  ('pagina_captura',    'Página de captura',        'texto', 'Atribuição da venda'),
  ('anuncio_id',        'ID do anúncio',            'oculto', 'Atribuição da venda'),
  ('conjunto_anuncios', 'Conjunto de anúncios',     'oculto', 'Atribuição da venda'),
  ('campanha_id',       'ID da campanha',           'oculto', 'Atribuição da venda')
on conflict (chave) do update set rotulo = excluded.rotulo, grupo = excluded.grupo;

-- ---- aplica em quem já entrou ----
update public.lead_atributos la
set dados = la.dados || public.extrair_atribuicao(la.dados),
    updated_at = now()
where la.dados ? 'hotmart_xcod' or la.dados ? 'hotmart_sck';

commit;

select count(*) filter (where dados ? 'origem_trafego') as com_origem,
       count(*) filter (where dados ? 'rede') as com_rede,
       count(*) filter (where dados ? 'pagina_captura') as com_pagina,
       count(*) as total_com_atributos
from public.lead_atributos;
