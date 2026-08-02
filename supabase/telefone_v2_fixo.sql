-- =====================================================================
-- FIXO NÃO GANHA O NONO DÍGITO
--
-- Eu tinha uma regra que dizia: "12 dígitos começando com 55? Então é
-- brasileiro sem o 9 — enfia o 9 depois do DDD." Está errado, e o erro
-- inventa o número de outra pessoa.
--
-- Como a numeração brasileira funciona, de fato:
--
--   FIXO   = 55 + DDD + 8 dígitos, começando em 2, 3, 4 ou 5
--   CELULAR= 55 + DDD + 9 dígitos, sempre começando em 9
--
-- Desde 14/02/2017 TODO celular do país tem o nono dígito. Não existe DDD
-- sem ele. Então um número de 12 dígitos ou é fixo (e aí não tem WhatsApp
-- e não deve ganhar 9 nenhum), ou é um cadastro velho de celular, anterior
-- a 2017 — e esse sim precisa do 9.
--
-- Quem decide entre os dois é o primeiro dígito depois do DDD.
--
-- Na base: dos 206 números de 12 dígitos, 21 são fixos. Nesses 21 a regra
-- antiga criava um celular que nunca existiu, ou pior, que existe e é de
-- outra pessoa. Num fluxo que aplica tag no ManyChat, é WhatsApp para
-- estranho.
--
-- A mesma correção vale para o nó "Formatar telefone" do n8n, que tem a
-- regra antiga.
-- =====================================================================
begin;

create or replace function public.normalizar_telefone(p_bruto text)
returns text
language plpgsql immutable as $$
declare
  n text := nullif(regexp_replace(coalesce(p_bruto, ''), '\D', '', 'g'), '');
  miolo text;
begin
  if n is null then return null; end if;

  -- tira o zero do DDD, quando alguém escreve (051)
  if length(n) in (11, 12) and left(n, 1) = '0' then
    n := substr(n, 2);
  end if;

  -- celular brasileiro completo: 55 + DDD + 9 + 8
  if length(n) = 13 and left(n, 2) = '55' then
    -- o 9 é obrigatório desde 2017; sem ele, com 13 dígitos, o número
    -- está torto — não é estrangeiro, é erro de digitação
    if substr(n, 5, 1) <> '9' then return null; end if;
    return n;
  end if;

  -- 12 dígitos com DDI: fixo ou celular velho, e o 5º dígito diz qual
  if length(n) = 12 and left(n, 2) = '55' then
    miolo := substr(n, 5, 1);
    if miolo in ('2', '3', '4', '5') then
      return null;                      -- fixo: não tem WhatsApp
    end if;
    return left(n, 4) || '9' || substr(n, 5);   -- celular de antes de 2017
  end if;

  -- estrangeiro já com DDI
  if length(n) >= 12 then return n; end if;

  -- celular brasileiro sem o DDI
  if length(n) = 11 and substr(n, 3, 1) = '9' then return '55' || n; end if;

  -- 11 dígitos sem esse 9: estrangeiro (EUA, por exemplo)
  if length(n) = 11 then return n; end if;

  -- 10 dígitos, sem DDI: mesma pergunta de antes
  if length(n) = 10 then
    miolo := substr(n, 3, 1);
    if miolo in ('2', '3', '4', '5') then
      return null;                      -- fixo
    end if;
    return '55' || left(n, 2) || '9' || substr(n, 3);
  end if;

  return null;
end $$;

commit;

-- prova, com as duas armadilhas juntas
select entrada, esperado, public.normalizar_telefone(entrada) as saiu,
       coalesce(public.normalizar_telefone(entrada), '(nulo)') is not distinct from
         coalesce(esperado, '(nulo)') as bate
from (values
  ('5551999990000',   '5551999990000'),  -- celular completo
  ('5551399990000',   null),             -- 13 dígitos sem o 9: torto
  ('551133334444',    null),             -- FIXO de SP: não vira celular
  ('5511988887777',   '5511988887777'),  -- celular de SP, completo
  ('551188887777',    '5511988887777'),  -- celular velho: ganha o 9
  ('11988887777',     '5511988887777'),  -- sem DDI
  ('1133334444',      null),             -- fixo sem DDI
  ('051988887777',    '5551988887777'),  -- (051) = DDD 51, com zero na frente
  ('351912345678',    '351912345678'),   -- Portugal
  ('123',             null)              -- curto demais
) v(entrada, esperado);
