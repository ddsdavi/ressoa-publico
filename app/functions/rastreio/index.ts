// Edge Function pública: tracking de abertura (pixel) e clique (redirect).
//   GET /rastreio?t=o&e=<envio_id>                  -> pixel 1x1 + evento open
//   GET /rastreio?t=c&e=<envio_id>&u=<url b64url>   -> evento click + redirect
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PIXEL = Uint8Array.from(atob(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
), (c) => c.charCodeAt(0));

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const tipo = url.searchParams.get("t");
  const envioId = url.searchParams.get("e");

  if (!envioId) return new Response("missing e", { status: 400 });

  const { data: envio } = await supabase
    .from("envios").select("envio_id, lead_fk").eq("envio_id", envioId).maybeSingle();

  if (envio) {
    if (tipo === "o") {
      await supabase.from("eventos_email").insert({
        envio_fk: envio.envio_id, lead_fk: envio.lead_fk, tipo: "open",
        occurred_at: new Date().toISOString(),
        payload: { ua: req.headers.get("user-agent") ?? "" },
      });
    } else if (tipo === "c") {
      const u = url.searchParams.get("u");
      const destino = u ? b64urlDecode(u) : null;
      await supabase.from("eventos_email").insert({
        envio_fk: envio.envio_id, lead_fk: envio.lead_fk, tipo: "click",
        url: destino, occurred_at: new Date().toISOString(),
        payload: { ua: req.headers.get("user-agent") ?? "" },
      });
      if (destino && /^https?:\/\//.test(destino)) {
        return Response.redirect(destino, 302);
      }
    }
  }

  if (tipo === "c") return new Response("link inválido", { status: 400 });
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
});
