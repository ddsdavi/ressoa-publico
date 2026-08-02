// Edge Function pública: descadastro (LGPD/CAN-SPAM).
//   GET  /descadastro?e=<envio_id>  -> página de confirmação
//   POST /descadastro?e=<envio_id>  -> marca status=2 em todas as listas do lead,
//                                      registra evento unsubscribe e supressão global.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const pagina = (corpo: string) => new Response(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Descadastro</title>
  <style>body{font-family:system-ui,sans-serif;background:#f6f4f1;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border-radius:12px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  button{background:#c0392b;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:16px;cursor:pointer}
  </style></head><body><div class="card">${corpo}</div></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } },
);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const envioId = url.searchParams.get("e");
  if (!envioId) return pagina("<h2>Link inválido</h2>");

  const { data: envio } = await supabase
    .from("envios").select("envio_id, lead_fk").eq("envio_id", envioId).maybeSingle();
  if (!envio) return pagina("<h2>Link inválido ou expirado</h2>");

  if (req.method === "GET") {
    return pagina(`<h2>Deseja parar de receber nossos e-mails?</h2>
      <p>Você deixará de receber todas as comunicações.</p>
      <form method="POST"><button type="submit">Sim, quero me descadastrar</button></form>`);
  }

  const { data: lead } = await supabase
    .from("tabela_1_leads").select("lead_id, email").eq("lead_id", envio.lead_fk).maybeSingle();

  if (lead) {
    await supabase.from("lead_listas")
      .update({ status: 2, updated_at: new Date().toISOString() })
      .eq("lead_fk", lead.lead_id);
    if (lead.email) {
      await supabase.from("supressao")
        .upsert({ email: lead.email, motivo: "unsubscribe_global", origem_envio_fk: envio.envio_id },
                { onConflict: "email", ignoreDuplicates: true });
    }
    await supabase.from("eventos_email").insert({
      envio_fk: envio.envio_id, lead_fk: lead.lead_id, tipo: "unsubscribe",
      occurred_at: new Date().toISOString(),
    });
    await supabase.from("eventos_sistema").insert({
      tipo: "lead_descadastrado", lead_fk: lead.lead_id,
      payload: { origem: "link_email", envio: envio.envio_id },
    });
  }
  return pagina("<h2>Pronto!</h2><p>Você não receberá mais nossos e-mails.</p>");
});
