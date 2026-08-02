-- =====================================================================
-- TAG DE TURMA v2 — ano com dois digitos no padrao do ManyChat.
--
-- A tela e a documentacao ja orientavam usar {AA}, mas nome_da_turma()
-- substituia apenas {AAAA}. O resultado podia manter "{AA}" literalmente
-- no nome e criar uma tag que nenhum fluxo do ManyChat escuta.
--
-- Esta versao aceita os dois formatos e prova a virada semanal no minuto
-- exato, no fuso de Sao Paulo, usando o nome real do Desafio Casa.
-- =====================================================================
begin;

create or replace function public.nome_da_turma(
  p_padrao text, p_dia int, p_hora int, p_fuso text, p_quando timestamptz)
returns text
language plpgsql immutable as $$
declare
  v_local timestamp;
  v_inicio date;
  v_turma date;
  v_dia int := coalesce(p_dia, 1);
  v_hora int := coalesce(p_hora, 7);
begin
  if coalesce(p_padrao, '') = '' then
    return null;
  end if;

  v_local := p_quando at time zone coalesce(p_fuso, 'America/Sao_Paulo');

  v_inicio := (date_trunc('week', v_local - make_interval(hours => v_hora))
               + make_interval(days => v_dia - 1))::date;

  if v_inicio > (v_local - make_interval(hours => v_hora))::date then
    v_inicio := v_inicio - 7;
  end if;

  v_turma := v_inicio + 7;

  return replace(replace(replace(replace(p_padrao,
           '{AAAA}', to_char(v_turma, 'YYYY')),
           '{AA}',   to_char(v_turma, 'YY')),
           '{MM}',   to_char(v_turma, 'MM')),
           '{DD}',   to_char(v_turma, 'DD'));
end $$;

grant execute on function public.nome_da_turma(text, int, int, text, timestamptz)
  to authenticated;

-- Configuracao confirmada pelo Davi para o Desafio Casa Harmonizada.
-- O ucode e o identificador estavel do produto; os outros campos da regra
-- (lista, tag interna e reembolso) permanecem como estao.
update public.hotmart_produtos
set tag_manychat_turma = true,
    tag_manychat_turma_padrao =
      'CASA_H_{AA}_{MM}_{DD} - COMPROU INGRESSO CASA_H',
    turma_dia_semana = 1,
    turma_hora = 7,
    turma_fuso = 'America/Sao_Paulo'
where ucode = '08f9c859-d655-4454-b67c-5ed600cd6650';

-- Falha a migracao inteira se qualquer limite semanal produzir a tag errada.
do $$
declare
  v_padrao constant text := 'CASA_H_{AA}_{MM}_{DD} - COMPROU INGRESSO CASA_H';
begin
  if public.nome_da_turma(v_padrao, 1, 7, 'America/Sao_Paulo',
       timestamptz '2026-08-03 06:59-03') is distinct from
       'CASA_H_26_08_03 - COMPROU INGRESSO CASA_H' then
    raise exception 'turma incorreta antes da virada de 03/08/2026';
  end if;

  if public.nome_da_turma(v_padrao, 1, 7, 'America/Sao_Paulo',
       timestamptz '2026-08-03 07:00-03') is distinct from
       'CASA_H_26_08_10 - COMPROU INGRESSO CASA_H' then
    raise exception 'turma incorreta na virada de 03/08/2026';
  end if;

  if public.nome_da_turma(v_padrao, 1, 7, 'America/Sao_Paulo',
       timestamptz '2026-08-10 06:59-03') is distinct from
       'CASA_H_26_08_10 - COMPROU INGRESSO CASA_H' then
    raise exception 'turma incorreta antes da virada de 10/08/2026';
  end if;

  if public.nome_da_turma(v_padrao, 1, 7, 'America/Sao_Paulo',
       timestamptz '2026-08-10 07:00-03') is distinct from
       'CASA_H_26_08_17 - COMPROU INGRESSO CASA_H' then
    raise exception 'turma incorreta na virada de 10/08/2026';
  end if;

  if public.nome_da_turma(v_padrao, 1, 7, 'America/Sao_Paulo',
       timestamptz '2026-08-17 07:00-03') is distinct from
       'CASA_H_26_08_24 - COMPROU INGRESSO CASA_H' then
    raise exception 'turma incorreta na virada de 17/08/2026';
  end if;
end $$;

commit;
