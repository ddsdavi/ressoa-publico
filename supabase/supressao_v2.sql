-- =====================================================================
-- SUPRESSÃO v2 — saber QUEM é quem, não só o e-mail.
--
-- Hoje a tela mostra "fulano@gmail.com | ac_import". Não dá para saber o
-- nome da pessoa, nem qual campanha causou o bounce, nem de onde ela veio.
--
-- As contagens vêm agregadas do banco: somar no navegador dá errado porque
-- a API corta em 1.000 linhas (armadilha nº 1).
-- =====================================================================
begin;

-- quantos em cada motivo — um número por motivo, calculado aqui dentro
create or replace function public.contagem_supressao()
returns table (motivo text, qtd bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(s.motivo, 'desconhecido'), count(*)
  from public.supressao s
  group by 1
  order by 2 desc
$$;

-- a lista, já com nome da pessoa e a campanha que originou
create or replace function public.supressao_detalhada(
  p_busca  text default null,
  p_motivo text default null,
  p_limite int  default 50,
  p_offset int  default 0)
returns table (
  email text, nome text, lead_id uuid, motivo text,
  campanha text, assunto text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.email::text,
         l.nome,
         l.lead_id,
         coalesce(s.motivo, 'desconhecido'),
         c.nome,
         m.subject,
         s.created_at
  from public.supressao s
  left join public.tabela_1_leads l on l.email = s.email
  left join public.envios e on e.envio_id = s.origem_envio_fk
  left join public.campanhas c on c.campanha_id = e.campanha_fk
  left join public.mensagens m on m.mensagem_id = e.mensagem_fk
  where (p_motivo is null or p_motivo = '' or s.motivo = p_motivo)
    and (p_busca is null or p_busca = ''
         or s.email::text ilike '%' || p_busca || '%'
         or l.nome ilike '%' || p_busca || '%')
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limite, 50), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

-- quantos casam com o filtro (para a paginação saber o total real)
create or replace function public.contar_supressao_filtrada(
  p_busca text default null, p_motivo text default null)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from public.supressao s
  left join public.tabela_1_leads l on l.email = s.email
  where (p_motivo is null or p_motivo = '' or s.motivo = p_motivo)
    and (p_busca is null or p_busca = ''
         or s.email::text ilike '%' || p_busca || '%'
         or l.nome ilike '%' || p_busca || '%')
$$;

grant execute on function public.contagem_supressao() to authenticated;
grant execute on function public.supressao_detalhada(text, text, int, int) to authenticated;
grant execute on function public.contar_supressao_filtrada(text, text) to authenticated;

commit;

-- prova: os motivos que existem hoje e um exemplo já com nome
select * from public.contagem_supressao();
