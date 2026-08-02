-- Guarda o token que a Hotmart manda, SEM ainda exigir nada.
--
-- Ativar a verificação com o valor errado faria o sistema recusar venda
-- de verdade — pior do que o risco que ela evita. Então primeiro observo
-- o que realmente chega em requisição real, comparo, e só depois ligo.
--
-- Só o começo e o tamanho ficam visíveis nas consultas; o valor inteiro
-- serve apenas para a comparação, feita dentro do banco.
begin;

alter table public.hotmart_eventos add column if not exists token_recebido text;

create or replace function public.hotmart_tokens_vistos()
returns table (inicio text, tamanho int, de_onde text, eventos bigint, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  select left(token_recebido, 6) || '…',
         length(token_recebido),
         case when corpo ? 'hottok' then 'corpo' else 'cabeçalho' end,
         count(*),
         max(recebido_em)
  from public.hotmart_eventos
  where coalesce(token_recebido, '') <> ''
  group by 1, 2, 3
  order by 4 desc
$$;
grant execute on function public.hotmart_tokens_vistos() to authenticated;

-- guarda o que já tinha vindo no corpo
update public.hotmart_eventos
set token_recebido = corpo->>'hottok'
where corpo ? 'hottok' and token_recebido is null;

commit;
select * from public.hotmart_tokens_vistos();
