-- =====================================================================
-- AQUECIMENTO v2 — sem teto diário.
--
-- Decisão do Davi em 06/08/2026: a operação não trabalha com teto de
-- e-mails por dia. O `envio_limite_diario` vai a 0.
--
-- Por que 0 e não apagar a chave: o zero já é a palavra que as duas
-- pontas entendem. O drenador da fila (`drenar_fila_envios`) só confere
-- teto `if v_limite > 0`, então com 0 ele nem olha. E a rampa
-- (`subir_rampa`) trata `v_limite <= 0` como "sem teto — rampa
-- concluída" e devolve sem escrever nada — ou seja, ela pode continuar
-- ligada e agendada que não recoloca degrau nenhum. Apagar a chave
-- daria no mesmo por causa do `nullif`, mas deixaria o painel sem valor
-- para mostrar.
--
-- O que NÃO muda, de propósito: o freio de entregabilidade continua de
-- hora em hora. Ele não limita volume — ele PARA o envio se bounce ou
-- reclamação passarem do aceitável. É rede de segurança, não teto.
-- =====================================================================

begin;

update public.app_config
   set valor = '0', updated_at = now()
 where chave = 'envio_limite_diario';

-- se a chave nunca tiver sido semeada, nasce já sem teto
insert into public.app_config (chave, valor) values ('envio_limite_diario', '0')
on conflict (chave) do nothing;

commit;

select chave, valor from public.app_config
 where chave in ('envio_limite_diario', 'aquecimento_ligado', 'envio_pausado')
 order by chave;
