-- contador de envios do formulário, chamado pela função pública
create or replace function public.incrementar_envios_formulario(p_slug text)
returns void language sql security definer set search_path = public as $$
  update public.formularios set envios = envios + 1, updated_at = now() where slug = p_slug;
$$;
grant execute on function public.incrementar_envios_formulario(text) to anon, authenticated, service_role;
select 'ok' as pronto;
