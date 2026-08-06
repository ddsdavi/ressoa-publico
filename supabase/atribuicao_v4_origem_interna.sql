-- =====================================================================
-- ATRIBUIÇÃO — as vendas que nascem dentro da própria Hotmart.
--
-- O extrator lê o sck esperando pares "chave=valor" (m=paid|s=ig|utm_id=…).
-- Só que às vezes a Hotmart manda no lugar disso um nome interno seco:
--
--   HOTMART_SALES_AGENT
--   HOTMART_CLUB_TRENDRECOMMENDERC
--   NEW_CLUB_SALES_PAGE_FROM_SHOWCASE_C
--
-- Não é lixo: é a resposta certa para "de onde veio essa venda" — ela veio
-- da vitrine, do recomendador ou de um agente da própria plataforma, não de
-- anúncio nosso. Como não tinha "=", o laço descartava tudo e essas pessoas
-- caíam em "(sem origem)" no relatório de atribuição — que é justamente o
-- balde onde ninguém consegue aprender nada.
--
-- Agora o nome inteiro vira origem_trafego, em minúsculas para ficar do
-- mesmo tamanho que os valores que já existem lá (paid_metaads). O xcod
-- continua tendo a palavra final: ele é a fonte mais específica das duas,
-- e só quando ele não disser nada é que o sck responde.
--
-- Junto vai a faxina do outro resto: quatro contatos guardavam a STRING
-- "undefined" no xcod, escrita por alguma página que mandou o parâmetro
-- vazio como texto. Nunca atrapalhou nada (o extrator já tratava JSON
-- malformado), mas é sujeira à vista de quem abre a ficha do contato.
-- =====================================================================
begin;

create or replace function public.extrair_atribuicao(p_dados jsonb)
returns jsonb
language plpgsql immutable as $$
declare
  v_x jsonb;
  v_out jsonb := '{}'::jsonb;
  v_sck text;
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
  v_sck := coalesce(p_dados->>'hotmart_sck','');

  if v_sck <> '' and position('=' in v_sck) = 0 then
    -- sem "=" não são pares: é nome interno da Hotmart. Só vale se o xcod
    -- tiver ficado calado — entre os dois, o xcod é o mais específico.
    if not (v_out ? 'origem_trafego') then
      v_out := v_out || jsonb_build_object('origem_trafego', lower(v_sck));
    end if;

  elsif v_sck <> '' then
    foreach v_par in array string_to_array(v_sck, '|') loop
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

-- ---- faxina: a string "undefined" não é valor de nada ----
-- o `dados ? chave` na frente é obrigatório: sem ele o coalesce casaria com
-- toda linha que não tem a chave, e a tabela inteira levaria updated_at novo.
update public.lead_atributos
set dados = dados - 'hotmart_xcod', updated_at = now()
where dados ? 'hotmart_xcod'
  and lower(coalesce(dados->>'hotmart_xcod','')) in ('undefined','null','');

update public.lead_atributos
set dados = dados - 'hotmart_sck', updated_at = now()
where dados ? 'hotmart_sck'
  and lower(coalesce(dados->>'hotmart_sck','')) in ('undefined','null','');

-- ---- aplica em quem já entrou, e só em quem ganha campo novo ----
update public.lead_atributos la
set dados = la.dados || public.extrair_atribuicao(la.dados),
    updated_at = now()
where (la.dados ? 'hotmart_xcod' or la.dados ? 'hotmart_sck')
  and exists (select 1
              from jsonb_each(public.extrair_atribuicao(la.dados)) e(k, v)
              where not (la.dados ? e.k));

commit;

-- confere: ninguém com dado cru deve sobrar sem origem identificada
select count(*) filter (where dados ? 'hotmart_xcod' or dados ? 'hotmart_sck') as com_bruto,
       count(*) filter (where (dados ? 'hotmart_xcod' or dados ? 'hotmart_sck')
                          and public.extrair_atribuicao(dados) = '{}'::jsonb) as sem_leitura,
       count(*) filter (where dados ? 'origem_trafego') as com_origem
from public.lead_atributos;
