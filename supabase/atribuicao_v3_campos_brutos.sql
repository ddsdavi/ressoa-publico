-- =====================================================================
-- ATRIBUIÇÃO — dar nome aos dois campos crus e ordenar o grupo.
--
-- O atribuicao_v1 desempacotou xcod e sck em campos legíveis (origem do
-- tráfego, mídia, rede…) e cadastrou SÓ os desempacotados. Os dois crus
-- continuaram no JSON de cada contato sem cadastro nenhum — e a página de
-- Campos, que compara o que existe nos dados com o que está cadastrado,
-- passou a avisar "2 campos aparecem nos dados mas não estão cadastrados".
--
-- O aviso estava certo e não havia nada quebrado: eles só não tinham nome.
-- Ficam cadastrados como OCULTOS, que é o que são — dado que o sistema
-- preenche sozinho, nunca pergunta em formulário. O rótulo diz "bruta"
-- de propósito: quem for segmentar tem que usar os campos desempacotados,
-- porque comparar o campo inteiro contra um JSON ou contra "m=paid|s=ig"
-- não filtra nada.
--
-- De quebra, o grupo inteiro ganha ordem de leitura. Todos estavam com
-- ordem 0, então a tela caía na ordem alfabética da chave e abria por
-- "ID do anúncio" — detalhe técnico antes da resposta que interessa, que
-- é de onde a pessoa veio.
-- =====================================================================
begin;

insert into public.campos_personalizados (chave, rotulo, tipo, grupo, ordem)
values
  ('hotmart_xcod', 'Origem bruta da Hotmart (xcod)', 'oculto', 'Atribuição da venda', 90),
  ('hotmart_sck',  'Origem bruta da Hotmart (sck)',  'oculto', 'Atribuição da venda', 91)
on conflict (chave) do update
set rotulo = excluded.rotulo,
    tipo   = excluded.tipo,
    grupo  = excluded.grupo,
    ordem  = excluded.ordem;

-- do mais legível para o mais técnico; os crus ficam no fim (90 e 91)
update public.campos_personalizados c
set ordem = v.ordem
from (values
  ('origem_trafego',    10),
  ('midia',             20),
  ('rede',              30),
  ('veio_de',           40),
  ('pagina_captura',    50),
  ('anuncio_id',        60),
  ('conjunto_anuncios', 70),
  ('campanha_id',       80)
) as v(chave, ordem)
where c.chave = v.chave;

commit;

-- confere: o grupo na ordem nova, e nenhum campo órfão sobrando
select c.ordem, c.chave, c.rotulo, c.tipo
from public.campos_personalizados c
where c.grupo = 'Atribuição da venda'
order by c.ordem, c.chave;

select count(*) as campos_orfaos
from public.campos_em_uso() where not cadastrado;
