-- =====================================================================
-- OS TIPOS DE PASSO ESTAVAM DESENCONTRADOS EM TRÊS LUGARES
--
-- A tela oferece um tipo, a restrição da tabela aceita outro conjunto, e o
-- executor sabe rodar um terceiro. Onde os três não batem, dá um destes
-- dois estragos:
--
--   1. A tela oferece e a restrição recusa → erro ao salvar. Chato, mas
--      aparece na cara de quem está montando.
--
--   2. A tela oferece, a restrição aceita, e o executor não conhece → o
--      passo é salvo, a automação roda, o passo é pulado sem fazer nada e
--      marcado como concluído. Ninguém fica sabendo. É o que acontecia com
--      "Descadastra de uma lista": salvava como desinscrever_lista, e o
--      executor só procurava por remover_lista.
--
-- Descoberto montando a automação de ponta a ponta em vez de conferir a
-- tela. Uma tela que salva não prova que o motor executa.
-- =====================================================================
begin;

-- 1. a restrição passa a aceitar tudo o que o executor sabe rodar
alter table public.automacao_passos drop constraint if exists automacao_passos_tipo_check;
alter table public.automacao_passos add constraint automacao_passos_tipo_check
  check (tipo in (
    'enviar_email', 'esperar', 'condicao',
    'aplicar_tag', 'remover_tag',
    'inscrever_lista', 'desinscrever_lista', 'remover_lista',
    'webhook', 'google_sheets', 'google_drive',
    'manychat_tag', 'pontuar', 'adicionar_a_automacao'
  ));

-- 2. o executor passa a aceitar os dois nomes de "sair da lista"
do $$
declare
  v_src text;
  v_novo text;
begin
  select prosrc into v_src from pg_proc where proname = 'executar_automacoes';

  if position('''desinscrever_lista''' in v_src) > 0 then
    raise notice 'já aceita os dois nomes';
    return;
  end if;

  v_novo := replace(v_src,
    'elsif v_passo.tipo = ''remover_lista'' then',
    'elsif v_passo.tipo in (''remover_lista'', ''desinscrever_lista'') then');

  if v_novo = v_src then
    raise exception 'não achei o ramo de remover_lista — a função mudou de forma';
  end if;

  execute 'create or replace function public.executar_automacoes() returns int '
       || 'language plpgsql security definer as $f$' || v_novo || '$f$';
end $$;

commit;

-- prova: todo tipo que a tela oferece passa na restrição E existe no executor
with tela as (
  select unnest(array['enviar_email','esperar','aplicar_tag','remover_tag',
                      'inscrever_lista','desinscrever_lista','google_sheets',
                      'google_drive','webhook','manychat_tag','condicao']) as tipo
)
select t.tipo,
       (select position('''' || t.tipo || '''' in prosrc) > 0
        from pg_proc where proname = 'executar_automacoes')            as o_executor_conhece,
       position('''' || t.tipo || '''' in
         (select pg_get_constraintdef(oid) from pg_constraint
          where conname = 'automacao_passos_tipo_check')) > 0          as a_tabela_aceita
from tela t order by t.tipo;
