-- =====================================================================
-- UMA LISTA PARA CADA PRODUTO
--
-- Cinco dos seis produtos tinham só a tag COMPROU_*, sem lista. Tag serve
-- para filtrar; lista é para onde se escreve. Sem lista, quem comprou a
-- Formação não podia receber um e-mail sequer — só aparecia num filtro.
--
-- Nenhum deles ganha tag de turma. A turma existe quando o produto abre
-- em ciclos (o Desafio abre toda segunda). Os outros não abrem: dois são
-- order bump do checkout do Desafio e os demais são vendidos avulsos. Tag
-- de turma aqui só criaria tag nova toda semana sem significar nada.
--
-- Quem já comprou entra na lista agora — a integração passou a existir
-- depois das primeiras vendas.
-- =====================================================================
begin;

create temporary table mapa (padrao text, lista_nome text, descricao text) on commit drop;
insert into mapa values
  ('Acompanhamento Res', 'ACOMPANHAMENTO_RESSONANTE',
   'Compradores do Acompanhamento Ressonante'),
  ('Forma',              'FORMACAO_BIORRESSONANCIA',
   'Compradores da Formação em Biorressonância Aplicada'),
  ('restaurar a energia','CURSO_ENERGIA_DA_CASA',
   'Compradores do curso de energia da casa (order bump do Desafio)'),
  ('Manual Pr',          'MANUAL_DECORACAO',
   'Compradores do Manual Prático de Decoração (order bump do Desafio)'),
  ('origem das doen',    'ORIGEM_DAS_DOENCAS',
   'Compradores do produto sobre a origem das doenças');

-- 1. cria a lista que faltar
insert into public.listas (nome, descricao)
select m.lista_nome, m.descricao from mapa m
where not exists (select 1 from public.listas l where l.nome = m.lista_nome);

-- 2. liga cada produto à sua lista
update public.hotmart_produtos p
set lista_fk = l.lista_id
from mapa m
join public.listas l on l.nome = m.lista_nome
where p.padrao_nome = m.padrao and p.lista_fk is null;

-- 3. quem já comprou entra
insert into public.lead_listas (lead_fk, lista_fk, status, source)
select distinct a.lead_fk, l.lista_id, 1, 'hotmart'
from public.tabela_4_alunos a
join mapa m on a.nome_produto ilike '%' || m.padrao || '%'
join public.listas l on l.nome = m.lista_nome
where a.status = 'aprovada' and a.lead_fk is not null
on conflict (lead_fk, lista_fk) do update set status = 1, updated_at = now();

commit;

select p.apelido,
       coalesce(l.nome, '(SEM LISTA)') as lista,
       (select count(*) from public.lead_listas ll
        where ll.lista_fk = p.lista_fk and ll.status = 1) as pessoas_na_lista,
       coalesce(t.nome, '—') as tag,
       coalesce(p.tag_turma_padrao, '—') as turma
from public.hotmart_produtos p
left join public.listas l on l.lista_id = p.lista_fk
left join public.tags   t on t.tag_id   = p.tag_fk
where p.ativo order by p.apelido;
