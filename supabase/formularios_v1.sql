-- =====================================================================
-- FORMULÁRIOS
--
-- Guarda o formulário montado no painel para que a função pública possa
-- servi-lo por um endereço próprio e receber o envio.
--
-- Decisão importante: o formulário guarda a LISTA e a TAG que aplica, e
-- não quem envia. Assim ninguém consegue, chamando a API por fora,
-- inscrever gente numa lista que o formulário não deveria tocar — o
-- servidor lê o destino do banco, não do que chegou na requisição.
-- =====================================================================
begin;

create table if not exists public.formularios (
  formulario_id uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  nome        text not null,
  titulo      text not null default '',
  subtitulo   text not null default '',
  campos      jsonb not null default '[]'::jsonb,
  lista_fk    int references public.listas(lista_id),
  tag_fk      int references public.tags(tag_id),
  botao       text not null default 'Quero participar',
  sucesso     text not null default 'Pronto! Confira seu e-mail.',
  redirecionar text,
  cor         text not null default '#6b4ea8',
  ativo       boolean not null default true,
  envios      int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.formularios enable row level security;

drop policy if exists form_le on public.formularios;
create policy form_le on public.formularios
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists form_escreve on public.formularios;
create policy form_escreve on public.formularios
  for all to authenticated
  using (public.papel_atual() in ('admin', 'terapeuta'))
  with check (public.papel_atual() in ('admin', 'terapeuta'));

grant select, insert, update, delete on public.formularios to authenticated;

-- um formulário de exemplo, já apontando para a maior lista ativa
insert into public.formularios (slug, nome, titulo, subtitulo, campos, lista_fk, botao)
select 'exemplo', 'Formulário de exemplo',
       'Receba os avisos das aulas',
       'Deixe seu melhor e-mail e avisamos antes de cada encontro.',
       '[{"campo":"nome","rotulo":"Seu nome","obrigatorio":true},
         {"campo":"email","rotulo":"Seu melhor e-mail","obrigatorio":true},
         {"campo":"whatsapp","rotulo":"WhatsApp","obrigatorio":false}]'::jsonb,
       (select l.lista_id from public.listas l
        join public.contagem_listas() c on c.lista_id = l.lista_id
        order by c.ativos desc limit 1),
       'Quero receber'
where not exists (select 1 from public.formularios where slug = 'exemplo');

commit;

select slug, nome, jsonb_array_length(campos) as campos,
       (select nome from public.listas where lista_id = f.lista_fk) as lista
from public.formularios f;
