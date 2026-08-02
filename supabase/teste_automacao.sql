-- Prova de que a cadeia gatilho -> evento -> automação -> passo funciona.
-- A automação de teste só aplica uma tag: nenhum e-mail sai, então dá para
-- rodar isto a qualquer momento sem risco.
begin;

insert into public.tags (nome, descricao)
select 'ZZ_TESTE_GATILHO', 'tag temporária de teste do motor'
where not exists (select 1 from public.tags where nome = 'ZZ_TESTE_GATILHO');

insert into public.tags (nome, descricao)
select 'ZZ_TESTE_RESULTADO', 'aplicada pela automação de teste'
where not exists (select 1 from public.tags where nome = 'ZZ_TESTE_RESULTADO');

insert into public.automacoes (nome, gatilho, ativa)
select 'ZZ TESTE DO MOTOR',
       jsonb_build_object('tipo', 'tag_adicionada',
                          'tag_id', (select tag_id from public.tags where nome = 'ZZ_TESTE_GATILHO')),
       true
where not exists (select 1 from public.automacoes where nome = 'ZZ TESTE DO MOTOR');

delete from public.automacao_passos
where automacao_fk = (select automacao_id from public.automacoes where nome = 'ZZ TESTE DO MOTOR');

insert into public.automacao_passos (automacao_fk, ordem, tipo, config)
select (select automacao_id from public.automacoes where nome = 'ZZ TESTE DO MOTOR'),
       1, 'aplicar_tag',
       jsonb_build_object('tag_id', (select tag_id from public.tags where nome = 'ZZ_TESTE_RESULTADO'));

-- limpa qualquer resíduo de execução anterior
delete from public.automacao_execucoes
where automacao_fk = (select automacao_id from public.automacoes where nome = 'ZZ TESTE DO MOTOR');
delete from public.lead_tags
where tag_fk in (select tag_id from public.tags where nome in ('ZZ_TESTE_GATILHO','ZZ_TESTE_RESULTADO'));

commit;

-- dispara: aplica a tag-gatilho no lead de teste
insert into public.lead_tags (lead_fk, tag_fk)
values ((select lead_id from public.tabela_1_leads where email = 'teste@exemplo.com'),
        (select tag_id from public.tags where nome = 'ZZ_TESTE_GATILHO'))
on conflict do nothing;

-- roda os dois passos do motor na mão, sem esperar o cron de 1 minuto
select public.processar_eventos_sistema() as eventos_processados;
select public.executar_automacoes() as passos_executados;
select public.executar_automacoes() as passos_executados_2;

-- veredito
select
  exists (select 1 from public.lead_tags lt
          join public.tags t on t.tag_id = lt.tag_fk
          where t.nome = 'ZZ_TESTE_RESULTADO'
            and lt.lead_fk = (select lead_id from public.tabela_1_leads
                              where email = 'teste@exemplo.com')) as automacao_rodou,
  (select status from public.automacao_execucoes
   where automacao_fk = (select automacao_id from public.automacoes where nome = 'ZZ TESTE DO MOTOR')
   limit 1) as status_da_execucao;
