-- Contagens agregadas no BANCO (o painel não pode somar linha a linha:
-- a API corta em 1.000 registros e a conta sai errada).
begin;

create or replace function public.contagem_listas()
returns table (lista_id int, ativos bigint, descadastrados bigint, bounces bigint, nao_confirmados bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select l.lista_id,
         count(*) filter (where ll.status = 1),
         count(*) filter (where ll.status = 2),
         count(*) filter (where ll.status = 3),
         count(*) filter (where ll.status = 0),
         count(ll.lead_fk)
  from public.listas l
  left join public.lead_listas ll on ll.lista_fk = l.lista_id
  group by l.lista_id
$$;

create or replace function public.contagem_tags()
returns table (tag_id int, total bigint)
language sql stable security definer set search_path = public as $$
  select t.tag_id, count(lt.lead_fk)
  from public.tags t
  left join public.lead_tags lt on lt.tag_fk = t.tag_id
  group by t.tag_id
$$;

grant execute on function public.contagem_listas() to authenticated;
grant execute on function public.contagem_tags() to authenticated;
commit;

select 'listas' as o, count(*) as n from public.contagem_listas()
union all select 'tags', count(*) from public.contagem_tags();
