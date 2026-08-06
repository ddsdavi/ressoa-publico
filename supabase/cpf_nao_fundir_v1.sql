-- =====================================================================
-- CPFs QUE NÃO SE FUNDEM
--
-- Mesmo CPF em dois cadastros nem sempre é a mesma pessoa. Duas causas
-- reais, decididas pelo dono em 06/08/2026:
--
-- 1. A ADMINISTRAÇÃO COMPRA PARA O ALUNO. O cadastro do suporte acumulou
--    compras de gente diferente, cada uma com o CPF do aluno. Fundir
--    juntaria alunos que não têm nada a ver um com o outro. Palavras
--    dele: "Esse email é da administração, que deve ter efetuado uma
--    compra para um aluno. Esse email não entra na compilação."
--
-- 2. PESSOAS DISTINTAS COM O MESMO CPF NO CHECKOUT. Alguém compra para
--    outra pessoa e preenche o próprio documento. São duas pessoas.
--
-- Sem registrar a decisão, a mesma lista voltaria a ser apresentada na
-- próxima conferência e alguém fundiria por engano. Aqui ela fica.
--
-- Quem tem mais de um e-mail MANTÉM os dois: a comunicação de cada
-- produto sai pelo e-mail daquela compra (email_da_compra_v1/v2/v3).
-- =====================================================================
begin;

create table if not exists public.cpf_nao_fundir (
  cpf        text primary key,
  motivo     text,
  decidido_em timestamptz not null default now()
);

comment on table public.cpf_nao_fundir is
  'CPFs repetidos que NÃO devem virar um cadastro só. Decisão registrada, não palpite.';

alter table public.cpf_nao_fundir enable row level security;

drop policy if exists cpf_nao_fundir_leitura on public.cpf_nao_fundir;
create policy cpf_nao_fundir_leitura on public.cpf_nao_fundir
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists cpf_nao_fundir_escrita on public.cpf_nao_fundir;
create policy cpf_nao_fundir_escrita on public.cpf_nao_fundir
  for all to authenticated
  using (public.papel_atual() = 'admin')
  with check (public.papel_atual() = 'admin');

-- Os CPFs de verdade NÃO moram aqui. Cada linha junta CPF e nome
-- completo de uma cliente — identificação direta de pessoa real —, e o
-- espelho deste projeto é público. Eles ficam em
-- `cpf_nao_fundir_dados.local.sql`, que o .gitignore segura na máquina.
--
-- Quem for reconstruir o banco do zero precisa rodar aquele arquivo
-- depois deste; sem ele a tabela nasce vazia e as fusões que precisavam
-- ser barradas voltam a acontecer. A forma de cada linha é esta:
--
--   insert into public.cpf_nao_fundir (cpf, motivo) values
--     ('00000000000', 'por que estas duas pessoas não podem ser fundidas')
--   on conflict (cpf) do update set motivo = excluded.motivo;

commit;

select count(*) as cpfs_marcados_para_nao_fundir from public.cpf_nao_fundir;
