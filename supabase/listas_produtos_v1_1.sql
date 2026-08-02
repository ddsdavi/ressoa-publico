-- Conserto do anterior: o casamento era por igualdade exata de padrao_nome,
-- e três produtos têm acento no campo. Passa a casar pelo apelido, que é
-- estável, com ilike.
begin;

create temporary table mapa (apelido_like text, lista_nome text, descricao text) on commit drop;
insert into mapa values
  ('%Forma%Biorres%',  'FORMACAO_BIORRESSONANCIA',
   'Compradores da Formação em Biorressonância Aplicada'),
  ('%Manual%Decora%',  'MANUAL_DECORACAO',
   'Compradores do Manual Prático de Decoração (order bump do Desafio)'),
  ('%Origem das doen%','ORIGEM_DAS_DOENCAS',
   'Compradores do produto sobre a origem das doenças');

insert into public.listas (nome, descricao)
select m.lista_nome, m.descricao from mapa m
where not exists (select 1 from public.listas l where l.nome = m.lista_nome);

update public.hotmart_produtos p
set lista_fk = l.lista_id
from mapa m
join public.listas l on l.nome = m.lista_nome
where p.apelido ilike m.apelido_like and p.lista_fk is null;

-- quem já comprou entra, casando pelo padrao_nome do próprio produto
insert into public.lead_listas (lead_fk, lista_fk, status, source)
select distinct a.lead_fk, p.lista_fk, 1, 'hotmart'
from public.tabela_4_alunos a
join public.hotmart_produtos p
  on a.nome_produto ilike '%' || p.padrao_nome || '%'
join mapa m on p.apelido ilike m.apelido_like
where a.status = 'aprovada' and a.lead_fk is not null and p.lista_fk is not null
on conflict (lead_fk, lista_fk) do update set status = 1, updated_at = now();

commit;

select p.apelido,
       coalesce(l.nome, '(SEM LISTA)') as lista,
       (select count(*) from public.lead_listas ll
        where ll.lista_fk = p.lista_fk and ll.status = 1) as na_lista,
       (select count(distinct a.lead_fk) from public.tabela_4_alunos a
        where a.status = 'aprovada'
          and a.nome_produto ilike '%' || p.padrao_nome || '%') as compradores
from public.hotmart_produtos p
left join public.listas l on l.lista_id = p.lista_fk
where p.ativo order by p.apelido;
