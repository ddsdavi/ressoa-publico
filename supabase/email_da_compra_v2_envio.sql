-- =====================================================================
-- O ENVIO PASSA A RESPEITAR O E-MAIL DA COMPRA
--
-- Segunda metade da regra do dono (06/08/2026): "as comunicações
-- relativas a um produto sempre serão com o e-mail da compra desse
-- produto". A primeira metade (guardar o e-mail e o CPF de cada compra)
-- está em email_da_compra_v1.sql.
--
-- COMO A AUTOMAÇÃO SABE DE QUE PRODUTO ELA FALA: pelo campo `produto`
-- da automação. Preenchido, todo e-mail que ela manda vai para o
-- endereço da compra daquele produto. Vazio, vai para o principal — que
-- é o certo para o que não fala de um produto (uma newsletter, um
-- convite de live). Quem chama pode also mandar o produto direto, no
-- contexto: {"produto": "Desafio Casa"}.
--
-- O ENDEREÇO É DECIDIDO NO ENFILEIRAMENTO e fica gravado na linha do
-- envio. Assim o relatório mostra para onde cada e-mail realmente foi, e
-- uma troca de cadastro depois não reescreve a história.
--
-- A ASSINATURA NÃO MUDA. Três assinaturas da mesma função convivendo já
-- custaram três dias de compras mudas neste projeto (armadilha 38): o
-- PostgREST devolve PGRST203 e quem chama engole o erro. Só o corpo muda.
-- =====================================================================
begin;

alter table public.envios
  add column if not exists para_email text;

comment on column public.envios.para_email is
  'Endereço escolhido no enfileiramento. Vazio = usa o principal do contato.';

alter table public.automacoes
  add column if not exists produto text;

comment on column public.automacoes.produto is
  'Produto de que esta automação fala. Preenchido, os e-mails vão para o endereço da compra desse produto. Vazio, vão para o e-mail principal.';

create or replace function public.enfileirar_email(
  p_lead uuid, p_mensagem uuid, p_campanha uuid default null,
  p_automacao uuid default null, p_passo uuid default null,
  p_contexto jsonb default null)
returns uuid
language plpgsql security definer as $$
declare
  v_email text;
  v_envio uuid;
  v_produto text;
begin
  -- de que produto esta mensagem fala: quem chamou tem a palavra final,
  -- senão a automação responde por si
  v_produto := nullif(trim(coalesce(p_contexto->>'produto', '')), '');
  if v_produto is null and p_automacao is not null then
    select nullif(trim(produto), '') into v_produto
      from public.automacoes where automacao_id = p_automacao;
  end if;

  v_email := public.email_para_contato(p_lead, v_produto);
  if coalesce(v_email, '') = '' then
    return null;                                   -- contato sem e-mail
  end if;

  -- A supressão vale para o endereço que VAI receber, não para o
  -- principal: quem pediu descadastro num endereço não pode voltar a
  -- receber só porque comprou com outro.
  if exists (select 1 from public.supressao s where s.email = v_email) then
    insert into public.envios (lead_fk, mensagem_fk, campanha_fk, automacao_fk,
                               passo_fk, status, contexto, para_email)
    values (p_lead, p_mensagem, p_campanha, p_automacao, p_passo, 'suppressed',
            p_contexto, v_email)
    on conflict do nothing;
    return null;
  end if;

  insert into public.envios
    (lead_fk, mensagem_fk, campanha_fk, automacao_fk, passo_fk, contexto, para_email)
  values (p_lead, p_mensagem, p_campanha, p_automacao, p_passo, p_contexto, v_email)
  on conflict do nothing
  returning envio_id into v_envio;
  return v_envio;
end $$;

-- confere que continua havendo exatamente uma
do $$
declare v_qtd int;
begin
  select count(*) into v_qtd from pg_proc
   where proname = 'enfileirar_email' and pronamespace = 'public'::regnamespace;
  if v_qtd <> 1 then
    raise exception 'enfileirar_email tem % assinaturas; deveria ter 1', v_qtd;
  end if;
end $$;

commit;
