-- Prova do "se / então": a mesma automação deve mandar dois contatos para
-- caminhos diferentes. Só aplica tags — nenhum e-mail sai.
--
-- Fluxo montado:
--   1  condição: tem a tag ZZ_VIP?
--        verdadeiro -> vai para o passo 2
--        falso      -> vai para o passo 4
--   2  aplica ZZ_CAMINHO_A
--   3  condição sempre falsa com destino 0  (encerra, para não cair no 4)
--   4  aplica ZZ_CAMINHO_B
begin;

insert into public.tags (nome) select x from unnest(array[
  'ZZ_VIP','ZZ_GATILHO2','ZZ_CAMINHO_A','ZZ_CAMINHO_B']) x
where not exists (select 1 from public.tags t where t.nome = x);

delete from public.automacao_execucoes where automacao_fk in
  (select automacao_id from public.automacoes where nome = 'ZZ TESTE CONDICAO');
delete from public.automacao_passos where automacao_fk in
  (select automacao_id from public.automacoes where nome = 'ZZ TESTE CONDICAO');
delete from public.automacoes where nome = 'ZZ TESTE CONDICAO';

insert into public.automacoes (nome, gatilho, ativa)
values ('ZZ TESTE CONDICAO',
        jsonb_build_object('tipo','tag_adicionada',
                           'tag_id',(select tag_id from public.tags where nome='ZZ_GATILHO2')),
        true);

insert into public.automacao_passos (automacao_fk, ordem, tipo, config)
select (select automacao_id from public.automacoes where nome='ZZ TESTE CONDICAO'), o, t, c
from (values
  (1, 'condicao', jsonb_build_object(
        'condicao', jsonb_build_object('tipo','tem_tag',
                     'tag_id',(select tag_id from public.tags where nome='ZZ_VIP')),
        'ir_se_verdadeiro', 2, 'ir_se_falso', 4)),
  (2, 'aplicar_tag', jsonb_build_object('tag_id',(select tag_id from public.tags where nome='ZZ_CAMINHO_A'))),
  (3, 'condicao', jsonb_build_object(
        'condicao', jsonb_build_object('tipo','tem_tag','tag_id',-1),
        'ir_se_verdadeiro', 0, 'ir_se_falso', 0)),
  (4, 'aplicar_tag', jsonb_build_object('tag_id',(select tag_id from public.tags where nome='ZZ_CAMINHO_B')))
) v(o,t,c);

-- dois contatos: o primeiro é VIP, o segundo não
insert into public.tabela_1_leads (nome, email)
select 'Teste Condicao B', 'zz.teste.condicao@exemplo.invalido'
where not exists (select 1 from public.tabela_1_leads where email='zz.teste.condicao@exemplo.invalido');

delete from public.lead_tags where tag_fk in
  (select tag_id from public.tags where nome like 'ZZ_%');

insert into public.lead_tags (lead_fk, tag_fk)
values ((select lead_id from public.tabela_1_leads where email='teste@exemplo.com'),
        (select tag_id from public.tags where nome='ZZ_VIP'));

commit;

-- dispara para os dois
insert into public.lead_tags (lead_fk, tag_fk)
select l.lead_id, (select tag_id from public.tags where nome='ZZ_GATILHO2')
from public.tabela_1_leads l
where l.email in ('teste@exemplo.com','zz.teste.condicao@exemplo.invalido')
on conflict do nothing;

select public.processar_eventos_sistema() as eventos;
select public.executar_automacoes() as r1;
select public.executar_automacoes() as r2;
select public.executar_automacoes() as r3;

-- veredito: o VIP tem que ter ido pelo A, o outro pelo B
select l.email,
       exists (select 1 from public.lead_tags lt join public.tags t on t.tag_id=lt.tag_fk
               where lt.lead_fk=l.lead_id and t.nome='ZZ_CAMINHO_A') as foi_pelo_A,
       exists (select 1 from public.lead_tags lt join public.tags t on t.tag_id=lt.tag_fk
               where lt.lead_fk=l.lead_id and t.nome='ZZ_CAMINHO_B') as foi_pelo_B
from public.tabela_1_leads l
where l.email in ('teste@exemplo.com','zz.teste.condicao@exemplo.invalido')
order by l.email;
