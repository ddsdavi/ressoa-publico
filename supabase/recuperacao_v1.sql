-- =====================================================================
-- RECUPERAÇÃO DE VENDA + ESTILOS GLOBAIS + MÓDULOS SALVOS
--
-- 1. CARRINHO ABANDONADO e BOLETO GERADO já chegam da Hotmart — só não
--    viravam gatilho. São as duas horas mais valiosas de uma operação de
--    infoproduto: a pessoa quis comprar e parou no meio.
--
-- 2. ESTILOS GLOBAIS: fonte, cores e fundo definidos uma vez, valendo
--    para todo e-mail novo.
--
-- 3. MÓDULOS SALVOS: um bloco montado uma vez e reusado. Cabeçalho e
--    assinatura são os casos óbvios — hoje são recriados a cada e-mail.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. os eventos que faltavam virar gatilho
-- ------------------------------------------------------------------
-- Estes NÃO são compra: a pessoa não pagou. Viram evento próprio para
-- disparar automação de recuperação, sem sujar o registro de vendas.
create or replace function public.registrar_intencao(
  p_lead uuid, p_evento text, p_produto text, p_valor numeric)
returns void
language sql security definer set search_path = public as $$
  insert into public.eventos_sistema (tipo, lead_fk, payload)
  values (
    case p_evento
      when 'PURCHASE_OUT_OF_SHOPPING_CART' then 'carrinho_abandonado'
      when 'PURCHASE_BILLET_PRINTED' then 'boleto_gerado'
      when 'PURCHASE_DELAYED' then 'pagamento_atrasado'
      when 'PURCHASE_EXPIRED' then 'pagamento_expirou'
      else 'intencao_de_compra' end,
    p_lead,
    jsonb_build_object('produto', p_produto, 'valor', p_valor, 'evento_hotmart', p_evento));
$$;
grant execute on function public.registrar_intencao(uuid, text, text, numeric)
  to authenticated, anon, service_role;

-- os gatilhos novos casam por produto, igual ao de compra
create or replace function public.processar_eventos_sistema() returns int
language plpgsql security definer as $$
declare
  v_evento record;
  v_auto record;
  v_hook record;
  v_qtd int := 0;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_evento in
    select * from public.eventos_sistema
    where processado_em is null
    order by evento_id
    limit 200
    for update skip locked
  loop
    for v_auto in
      select a.automacao_id from public.automacoes a
      where a.ativa
        and a.gatilho is not null
        and a.gatilho->>'tipo' = v_evento.tipo
        and (
          (v_evento.tipo in ('lista_inscrita', 'lista_descadastrada') and (
             coalesce((a.gatilho->>'qualquer_lista')::boolean, false)
             or a.gatilho->>'lista_id' is null
             or (a.gatilho->>'lista_id')::int = (v_evento.payload->>'lista_id')::int))
          or
          (v_evento.tipo = 'tag_adicionada' and
             (a.gatilho->>'tag_id')::int = (v_evento.payload->>'tag_id')::int)
          or
          (v_evento.tipo in ('email_aberto', 'email_clicado') and (
             a.gatilho->>'campanha_id' is null
             or a.gatilho->>'campanha_id' = v_evento.payload->>'campanha_id'))
          or
          -- compra e as intenções: filtro opcional por produto
          (v_evento.tipo in ('compra_realizada', 'carrinho_abandonado', 'boleto_gerado',
                             'pagamento_atrasado', 'pagamento_expirou') and (
             a.gatilho->>'produto' is null
             or v_evento.payload->>'produto' ilike '%' || (a.gatilho->>'produto') || '%'))
          or
          (v_evento.tipo not in ('lista_inscrita', 'lista_descadastrada', 'tag_adicionada',
                                 'email_aberto', 'email_clicado', 'compra_realizada',
                                 'carrinho_abandonado', 'boleto_gerado',
                                 'pagamento_atrasado', 'pagamento_expirou'))
        )
    loop
      if not exists (select 1 from public.automacao_execucoes e
                     where e.automacao_fk = v_auto.automacao_id
                       and e.lead_fk = v_evento.lead_fk
                       and e.status in ('em_andamento', 'aguardando', 'ativa')) then
        insert into public.automacao_execucoes (automacao_fk, lead_fk, passo_atual, agendado_para)
        values (v_auto.automacao_id, v_evento.lead_fk, 1, now());
      end if;
    end loop;

    if v_webhooks then
      for v_hook in
        select * from public.webhooks_saida w where w.ativo and v_evento.tipo = any(w.eventos)
      loop
        perform net.http_post(
          url := v_hook.url,
          body := jsonb_build_object(
            'evento', v_evento.tipo, 'payload', v_evento.payload,
            'contato', case when v_evento.lead_fk is not null
                            then public.payload_contato(v_evento.lead_fk) end,
            'ocorrido_em', v_evento.created_at),
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'X-Webhook-Secret', coalesce(v_hook.secret, '')));
      end loop;
    end if;

    update public.eventos_sistema set processado_em = now() where evento_id = v_evento.evento_id;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- ------------------------------------------------------------------
-- 2. estilos globais do e-mail
-- ------------------------------------------------------------------
insert into public.app_config (chave, valor) values
  ('email_fonte', 'Arial, Helvetica, sans-serif'),
  ('email_cor_texto', '#3c3646'),
  ('email_cor_titulo', '#1f1a2e'),
  ('email_cor_destaque', '#6b4ea8'),
  ('email_cor_fundo', '#f4f1ec'),
  ('email_largura', '600')
on conflict (chave) do nothing;

-- ------------------------------------------------------------------
-- 3. módulos salvos
-- ------------------------------------------------------------------
create table if not exists public.email_modulos (
  modulo_id  uuid primary key default gen_random_uuid(),
  nome       text not null,
  html       text not null,
  criado_por text,
  created_at timestamptz not null default now()
);

alter table public.email_modulos enable row level security;
drop policy if exists mod_le on public.email_modulos;
create policy mod_le on public.email_modulos
  for select to authenticated using (public.papel_atual() is not null);
drop policy if exists mod_escreve on public.email_modulos;
create policy mod_escreve on public.email_modulos
  for all to authenticated
  using (public.papel_atual() in ('admin', 'terapeuta'))
  with check (public.papel_atual() in ('admin', 'terapeuta'));
grant select, insert, update, delete on public.email_modulos to authenticated;

commit;

select (select count(*) from public.app_config where chave like 'email_%') as estilos_globais,
       (select count(*) from public.email_modulos) as modulos,
       (select position('carrinho_abandonado' in prosrc) > 0
        from pg_proc where proname = 'processar_eventos_sistema') as gatilho_de_carrinho;
