-- Traz TODAS as definições de campo do ActiveCampaign, não só as que têm
-- valor gravado. O AC define 26 campos; só 11 tinham dado preenchido, então
-- o cadastro automático anterior deixou 15 de fora.
--
-- Guarda também a variável antiga (%UTMSOURCE%): e-mails escritos no AC usam
-- essa forma, e eles continuam funcionando aqui sem reescrever nada.
begin;

alter table public.campos_personalizados add column if not exists perstag text;

insert into public.campos_personalizados (chave, rotulo, tipo, grupo, opcoes, ordem, perstag)
values
  ('Idioma de preferência', 'Idioma de preferência', 'lista_opcoes', 'Detalhes gerais', array['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48','49','50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65','66','67','68','69','70','71','72','73','74','75'], 0, 'IDIOMA_DE_PREFERNCIA'),
  ('BLK-UTM-SOURCE', 'BLK-UTM-SOURCE', 'oculto', 'BLK-UTMS', null, 0, 'UTMSOURCE'),
  ('16LC-UTM-CAMPAIGN', '16LC-UTM-CAMPAIGN', 'oculto', '16LC-UTMS', null, 1, '1UTMCAMPAIGN'),
  ('16LC-UTM-SOURCE', '16LC-UTM-SOURCE', 'oculto', '16LC-UTMS', null, 2, '1UTMSOURCE'),
  ('16LC-UTM-TERM', '16LC-UTM-TERM', 'oculto', '16LC-UTMS', null, 3, '1UTMTERM'),
  ('16LC-UTM-ID', '16LC-UTM-ID', 'oculto', '16LC-UTMS', null, 4, '1UTMID'),
  ('16LC-UTM-MEDIUM', '16LC-UTM-MEDIUM', 'oculto', '16LC-UTMS', null, 5, '1UTMMEDIUM'),
  ('16LC-UTM-CONTENT', '16LC-UTM-CONTENT', 'oculto', '16LC-UTMS', null, 7, '1UTMCONTENT'),
  ('BLK-UTM-CAMPAGIN', 'BLK-UTM-CAMPAGIN', 'oculto', 'BLK-UTMS', null, 8, 'UTMCAMPAGIN'),
  ('BLK-UTM-TERM', 'BLK-UTM-TERM', 'oculto', 'BLK-UTMS', null, 10, 'UTMTERM'),
  ('BLK-UTM-ID', 'BLK-UTM-ID', 'oculto', 'BLK-UTMS', null, 11, 'UTMID'),
  ('BLK-UTM-MEDIUM', 'BLK-UTM-MEDIUM', 'oculto', 'BLK-UTMS', null, 12, 'UTMMEDIUM'),
  ('BLK-UTM-CONTENT', 'BLK-UTM-CONTENT', 'oculto', 'BLK-UTMS', null, 13, 'UTMCONTENT'),
  ('BLACK-UTM-CAMPAIGN', 'BLACK-UTM-CAMPAIGN', 'texto', 'BLACK2025-UTMS', null, 14, 'BLACKUTMCAMPAIGN'),
  ('BLACK-UTM-SOURCE', 'BLACK-UTM-SOURCE', 'texto', 'BLACK2025-UTMS', null, 15, 'BLACKUTMSOURCE'),
  ('BLACK-UTM-TERM', 'BLACK-UTM-TERM', 'texto', 'BLACK2025-UTMS', null, 16, 'BLACKUTMTERM'),
  ('BLACK-UTM-CONTENT', 'BLACK-UTM-CONTENT', 'texto', 'BLACK2025-UTMS', null, 17, 'BLACKUTMCONTENT'),
  ('BLACK-UTM-MEDIUM', 'BLACK-UTM-MEDIUM', 'texto', 'BLACK2025-UTMS', null, 18, 'BLACKUTMMEDIUM'),
  ('BLACK-UTM-ID', 'BLACK-UTM-ID', 'texto', 'BLACK2025-UTMS', null, 19, 'BLACKUTMID'),
  ('IMA-UTM-CAMPAIGN', 'IMA-UTM-CAMPAIGN', 'oculto', 'IMA07-02', null, 20, 'IMAUTMCAMPAIGN'),
  ('IMA-UTM-SOURCE', 'IMA-UTM-SOURCE', 'oculto', 'IMA07-02', null, 21, 'IMAUTMSOURCE'),
  ('IMA-UTM-TERM', 'IMA-UTM-TERM', 'oculto', 'IMA07-02', null, 22, 'IMAUTMTERM'),
  ('IMA-UTM-CONTENT', 'IMA-UTM-CONTENT', 'oculto', 'IMA07-02', null, 23, 'IMAUTMCONTENT'),
  ('IMA-UTM-MEDIUM', 'IMA-UTM-MEDIUM', 'oculto', 'IMA07-02', null, 24, 'IMAUTMMEDIUM'),
  ('IMA-UTM-ID', 'IMA-UTM-ID', 'oculto', 'IMA07-02', null, 25, 'IMAUTMID'),
  ('IMA-DATA-DE-INSCRICAO', 'IMA-DATA-DE-INSCRICAO', 'oculto', 'IMA07-02', null, 26, 'IMADATADEINSCRICAO')
on conflict (chave) do update
set rotulo  = excluded.rotulo,
    tipo    = excluded.tipo,
    grupo   = excluded.grupo,
    opcoes  = coalesce(excluded.opcoes, public.campos_personalizados.opcoes),
    ordem   = excluded.ordem,
    perstag = excluded.perstag;

commit;

select grupo, count(*) as campos
from public.campos_personalizados
group by grupo order by 2 desc;
