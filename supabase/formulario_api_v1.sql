-- =====================================================================
-- CHAVE DA CHAMADA POR API DO /formulario
--
-- O POST em /formulario sem form_slug aceita lista_id e tag_id do próprio
-- corpo — quem chama decide onde a pessoa entra. Com o envio real
-- destravado, isso era uma porta anônima para inscrever qualquer e-mail em
-- qualquer lista e disparar automação com e-mail de verdade em nome da
-- casa. Agora esse caminho exige a chave `formulario_api_key`.
--
-- A chave mora em public.segredos (armadilha 23: segredo não mora em
-- tabela que o painel lê). Este arquivo só abre a porta da TELA: a lista
-- fechada de guardar_segredo ganha o nome novo, para o admin criar e
-- trocar a chave em Configurações sem redeploy. O valor em si nunca passa
-- pelo repositório. O caminho com form_slug continua público — lista e
-- tag vêm do banco.
-- =====================================================================
begin;

create or replace function public.guardar_segredo(p_chave text, p_valor text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  -- "is distinct from", não "<>". papel_atual() devolve null para quem não
  -- está logado, e em SQL `null <> 'admin'` vale NULL — que não é verdadeiro,
  -- então o if não dispara e a porta fica aberta para a chave pública.
  -- Custou um teste com curl anônimo para aparecer (armadilha 30).
  if public.papel_atual() is distinct from 'admin' then
    raise exception 'só admin muda segredo';
  end if;
  -- lista fechada: assim ninguém usa esta função para gravar qualquer coisa
  if p_chave not in ('manychat_api_key', 'service_key', 'formulario_api_key') then
    raise exception 'segredo desconhecido: %', p_chave;
  end if;

  if coalesce(btrim(p_valor), '') = '' then
    delete from public.segredos where chave = p_chave;
    return 'removido';
  end if;

  insert into public.segredos (chave, valor) values (p_chave, btrim(p_valor))
  on conflict (chave) do update set valor = excluded.valor, updated_at = now();
  return 'guardado';
end $$;

commit;

select position('formulario_api_key' in prosrc) > 0 as whitelist_atualizada
from pg_proc where proname = 'guardar_segredo';
