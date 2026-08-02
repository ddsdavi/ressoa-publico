-- =====================================================================
-- MOTOR v4 — descadastro em TODO e-mail, do jeito que Gmail/Yahoo exigem:
--   (a) link visível no rodapé + endereço físico  [já existia]
--   (b) cabeçalhos List-Unsubscribe e List-Unsubscribe=One-Click  [novo]
-- Sem isso, remetente em massa cai no spam por política, não por conteúdo.
-- =====================================================================
begin;

create or replace function public.processar_fila_envios() returns int
language plpgsql security definer as $$
declare
  v_envio record;
  v_msg record;
  v_provedor text := coalesce(public.cfg('provedor_email'), 'simulado');
  v_key text := public.cfg('resend_api_key');
  v_base text := public.cfg('base_url_tracking');
  v_url_desc text;
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

    v_url_desc := v_base || '/descadastro?e=' || v_envio.envio_id;

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
          'headers', jsonb_build_object(
            'X-Entity-Ref-ID', v_envio.envio_id,
            -- exigência do Gmail/Yahoo para remetente em massa (fev/2024)
            'List-Unsubscribe', '<' || v_url_desc || '>',
            'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click')),
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

-- prova: monta o HTML de um envio fictício e confere se tem rodapé de descadastro
select position('descadastro' in public.montar_html_envio(
         '<html><body><p>Teste</p></body></html>',
         gen_random_uuid(),
         (select lead_id from public.tabela_1_leads limit 1))) > 0 as tem_link_descadastro,
       position('Rua Exemplo' in public.montar_html_envio(
         '<html><body><p>Teste</p></body></html>',
         gen_random_uuid(),
         (select lead_id from public.tabela_1_leads limit 1))) > 0 as tem_endereco_fisico;
