-- MOTOR v1.1 — injeta pixel de abertura e link de descadastro no HTML dos envios.
-- (Reescrita de links para rastreio de clique fica para a v1.2, junto do editor.)
begin;

update public.app_config
set valor = 'https://SEU-PROJETO.supabase.co/functions/v1', updated_at = now()
where chave = 'base_url_tracking';

create or replace function public.montar_html_envio(p_html text, p_envio uuid, p_lead uuid) returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_html text := public.personalizar(p_html, p_lead);
  v_rodape text;
begin
  if coalesce(v_base, '') = '' then
    return v_html;
  end if;
  v_rodape :=
    '<div style="text-align:center;font-size:12px;color:#8a8a8a;padding:24px 12px;font-family:sans-serif">' ||
    'Sua Empresa Ltda, Rua Exemplo 123 &middot; ' ||
    '<a href="' || v_base || '/descadastro?e=' || p_envio ||
    '" style="color:#8a8a8a">Não quero mais receber estes e-mails</a></div>' ||
    '<img src="' || v_base || '/rastreio?t=o&e=' || p_envio ||
    '" width="1" height="1" alt="" style="display:none">';
  if position('</body>' in lower(v_html)) > 0 then
    -- insere antes do </body>, preservando o restante
    return regexp_replace(v_html, '</body>', v_rodape || '</body>', 'i');
  end if;
  return v_html || v_rodape;
end $$;

-- fila de envios agora usa montar_html_envio
create or replace function public.processar_fila_envios() returns int
language plpgsql security definer as $$
declare
  v_envio record;
  v_msg record;
  v_provedor text := coalesce(public.cfg('provedor_email'), 'simulado');
  v_key text := public.cfg('resend_api_key');
  v_req bigint;
  v_qtd int := 0;
begin
  for v_envio in
    select e.*, l.email as para_email, l.nome as para_nome
    from public.envios e
    join public.tabela_1_leads l on l.lead_id = e.lead_fk
    where e.status = 'queued'
    order by e.queued_at
    limit 100
    for update of e skip locked
  loop
    select * into v_msg from public.mensagens where mensagem_id = v_envio.mensagem_fk;

    if exists (select 1 from public.supressao s where s.email = v_envio.para_email) then
      update public.envios set status = 'suppressed' where envio_id = v_envio.envio_id;
      continue;
    end if;

    if v_provedor = 'resend' and coalesce(v_key,'') <> '' then
      v_req := net.http_post(
        url := 'https://api.resend.com/emails',
        body := jsonb_build_object(
          'from', coalesce(nullif(v_msg.from_name,''), public.cfg('from_name_padrao'))
                  || ' <' || coalesce(nullif(v_msg.from_email,''), public.cfg('from_email_padrao')) || '>',
          'to', jsonb_build_array(v_envio.para_email),
          'subject', public.personalizar(v_msg.subject, v_envio.lead_fk),
          'html', public.montar_html_envio(v_msg.html, v_envio.envio_id, v_envio.lead_fk),
          'reply_to', v_msg.reply_to,
          'headers', jsonb_build_object('X-Entity-Ref-ID', v_envio.envio_id)),
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key,
                                      'Content-Type', 'application/json'));
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'resend', provider_message_id = 'pgnet:' || v_req
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), jsonb_build_object('req', v_req));

    else
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'simulado'
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), '{"simulado": true}'::jsonb);
    end if;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

commit;
