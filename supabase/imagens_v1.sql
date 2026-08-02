-- =====================================================================
-- BIBLIOTECA DE IMAGENS DO E-MAIL
--
-- Sem upload, o editor so serve para texto: toda imagem precisaria estar
-- hospedada em outro lugar antes. E imagem em e-mail tem que ser PUBLICA
-- — quem abre a mensagem nao esta logado no sistema, entao o servidor
-- precisa entregar o arquivo sem pedir nada.
--
-- Por isso o bucket e publico, e por isso ele so aceita imagem: publico +
-- qualquer tipo de arquivo seria um lugar aberto para hospedar coisa
-- ruim usando o seu dominio.
-- =====================================================================
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens', 'imagens', true, 5242880,
        array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = excluded.allowed_mime_types;

-- quem recebe o e-mail le sem estar logado
drop policy if exists img_leitura_publica on storage.objects;
create policy img_leitura_publica on storage.objects
  for select to public using (bucket_id = 'imagens');

-- so quem opera envia
drop policy if exists img_envio on storage.objects;
create policy img_envio on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imagens' and public.papel_atual() in ('admin','terapeuta','assistente'));

drop policy if exists img_remove on storage.objects;
create policy img_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'imagens' and public.papel_atual() in ('admin','terapeuta'));

commit;

select id, public, file_size_limit / 1024 / 1024 as limite_mb,
       array_length(allowed_mime_types, 1) as tipos_aceitos
from storage.buckets where id = 'imagens';
