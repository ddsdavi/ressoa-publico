-- =====================================================================
-- MOTOR v7 — o endereço físico do rodapé sai do código e vai para as
-- Configurações.
--
-- Estava escrito "Sua Empresa Ltda, Rua Exemplo 123" — um texto de exemplo que
-- eu deixei no começo e nunca troquei. Foi assim que saiu no primeiro
-- e-mail real. Endereço falso em e-mail comercial é problema duplo:
-- é sinal de spam para o Gmail e é irregular perante a lei anti-spam,
-- que exige endereço verdadeiro de quem envia.
--
-- Além disso: preso no código, ele só muda com deploy. Nas Configurações,
-- muda em dois cliques e vale para o envio seguinte.
-- =====================================================================
begin;

insert into public.app_config (chave, valor)
values ('endereco_fisico', '')
on conflict (chave) do nothing;

create or replace function public.montar_html_envio(p_html text, p_envio uuid, p_lead uuid) returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_html text := public.personalizar(p_html, p_lead);
  v_end  text := public.cfg('endereco_fisico');
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
  -- Sem endereço configurado, o rodapé sai só com o descadastro. Melhor
  -- faltar do que mentir: endereço inventado é pior do que nenhum.
  v_rodape :=
    '<div style="text-align:center;font-size:12px;color:#8a8a8a;padding:24px 12px;font-family:sans-serif">' ||
    case when coalesce(v_end, '') <> '' then v_end || ' &middot; ' else '' end ||
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

-- prova: o texto de exemplo sumiu do e-mail
select position('Rua Exemplo' in public.montar_html_envio(
         '<html><body><p>x</p></body></html>',
         (select envio_id from public.envios limit 1),
         (select lead_id from public.tabela_1_leads limit 1))) = 0 as endereco_falso_removido,
       coalesce(nullif(public.cfg('endereco_fisico'), ''), '(precisa preencher em Configurações)') as endereco_atual;
