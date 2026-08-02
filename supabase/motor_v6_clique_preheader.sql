-- =====================================================================
-- MOTOR v6 — duas coisas que faltavam no e-mail que sai:
--
--   1. RASTREIO DE CLIQUE. A Edge Function já sabia registrar clique
--      (/rastreio?t=c), mas ninguém reescrevia os links do e-mail para
--      passar por ela. Resultado: todo relatório mostraria ZERO cliques,
--      para sempre. Ficou pendente desde a v1.1 ("fica para a v1.2").
--
--   2. TEXTO DE PRÉVIA (preheader). A coluna existia no banco e nunca era
--      usada. É o trecho que aparece ao lado do assunto na caixa de
--      entrada — depois do assunto, é o que mais mexe na taxa de abertura.
--
-- O link de descadastro é montado DEPOIS da reescrita, de propósito: se
-- ele passasse pelo rastreio, o cancelamento de 1 clique do Gmail quebraria.
-- =====================================================================
begin;

create or replace function public.montar_html_envio(p_html text, p_envio uuid, p_lead uuid) returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_html text := public.personalizar(p_html, p_lead);
  v_pre text;
  v_rodape text;
  v_m text[];
  v_url text;
  v_novo text;
begin
  if coalesce(v_base, '') = '' then
    return v_html;
  end if;

  -- ---- 1. rastreio de clique -------------------------------------------
  -- Cada link externo vira um desvio pela nossa função, que registra o
  -- clique e redireciona. Links que já apontam para o próprio sistema
  -- (rastreio, descadastro) ficam intactos.
  for v_m in select regexp_matches(v_html, 'href="(https?://[^"]*)"', 'g') loop
    v_url := v_m[1];
    if position(v_base in v_url) = 0 then
      v_novo := v_base || '/rastreio?t=c&amp;e=' || p_envio || '&amp;u=' ||
                translate(encode(convert_to(v_url, 'UTF8'), 'base64'),
                          '+/=' || chr(10) || chr(13), '-_');
      v_html := replace(v_html, 'href="' || v_url || '"', 'href="' || v_novo || '"');
    end if;
  end loop;

  -- ---- 2. texto de prévia ----------------------------------------------
  select public.personalizar(m.preheader, p_lead) into v_pre
  from public.envios e
  join public.mensagens m on m.mensagem_id = e.mensagem_fk
  where e.envio_id = p_envio;

  if coalesce(v_pre, '') <> '' then
    -- invisível no corpo, visível na lista de e-mails. O segundo bloco
    -- empurra o texto do corpo para fora da prévia com espaços invisíveis.
    v_pre := '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             v_pre ||
             '</div><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             repeat('&#847;&zwnj;&nbsp;', 40) || '</div>';
    if position('<body' in lower(v_html)) > 0 then
      v_html := regexp_replace(v_html, '(<body[^>]*>)', '\1' || v_pre, 'i');
    else
      v_html := v_pre || v_html;
    end if;
  end if;

  -- ---- 3. rodapé obrigatório + pixel de abertura ------------------------
  v_rodape :=
    '<div style="text-align:center;font-size:12px;color:#8a8a8a;padding:24px 12px;font-family:sans-serif">' ||
    'Sua Empresa Ltda, Rua Exemplo 123 &middot; ' ||
    '<a href="' || v_base || '/descadastro?e=' || p_envio ||
    '" style="color:#8a8a8a">Não quero mais receber estes e-mails</a></div>' ||
    '<img src="' || v_base || '/rastreio?t=o&e=' || p_envio ||
    '" width="1" height="1" alt="" style="display:none">';

  if position('</body>' in lower(v_html)) > 0 then
    return regexp_replace(v_html, '</body>', v_rodape || '</body>', 'i');
  end if;
  return v_html || v_rodape;
end $$;

commit;

-- prova: um HTML com link externo deve sair com o link reescrito, o
-- descadastro intacto e o pixel no fim.
with amostra as (
  select public.montar_html_envio(
    '<html><body><p>Oi {{nome}}</p><a href="https://seudominio.com.br/aula">Ver aula</a></body></html>',
    (select envio_id from public.envios limit 1),
    (select lead_id from public.tabela_1_leads limit 1)) as h
)
select position('rastreio?t=c' in h) > 0 as clique_rastreado,
       position('seudominio.com.br/aula"' in h) = 0 as link_original_sumiu,
       position('/descadastro?e=' in h) > 0 as descadastro_intacto,
       position('rastreio?t=o' in h) > 0 as pixel_abertura
from amostra;
