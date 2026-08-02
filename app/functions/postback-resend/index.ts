// Edge Function: postbacks (webhooks) do Resend.
//   POST /postback-resend  — eventos: email.delivered, email.bounced,
//   email.complained, email.opened, email.clicked, email.delivery_delayed
//   Correlaciona pelo header X-Entity-Ref-ID (nosso envio_id) ou pelo e-mail.
//   Bounce/complaint alimentam a supressão automaticamente.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAPA: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "deferred",
  "email.bounced": "bounce_hard",
  "email.complained": "complaint",
  "email.opened": "open",
  "email.clicked": "click",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const evt = await req.json().catch(() => null);
  if (!evt?.type || !MAPA[evt.type]) return new Response("ignorado");

  const tipo = MAPA[evt.type];
  const dados = evt.data ?? {};
  const emailDestino = (dados.to?.[0] ?? "").toLowerCase();
  const providerEventId = evt.data?.email_id ? `${evt.data.email_id}:${evt.type}:${evt.created_at ?? ""}` : null;

  // correlaciona com o envio: por headers X-Entity-Ref-ID (envio_id) ou último envio pro e-mail
  let envio: { envio_id: string; lead_fk: string } | null = null;
  const refId = dados.headers?.find?.((h: { name: string }) =>
    h.name?.toLowerCase() === "x-entity-ref-id")?.value;
  if (refId) {
    const { data } = await supabase.from("envios")
      .select("envio_id, lead_fk").eq("envio_id", refId).maybeSingle();
    envio = data;
  }
  if (!envio && emailDestino) {
    const { data } = await supabase.from("envios")
      .select("envio_id, lead_fk, tabela_1_leads!inner(email)")
      .ilike("tabela_1_leads.email", emailDestino)
      .order("queued_at", { ascending: false }).limit(1).maybeSingle();
    envio = data as never;
  }
  if (!envio) return new Response("sem correlacao");

  await supabase.from("eventos_email").insert({
    envio_fk: envio.envio_id,
    lead_fk: envio.lead_fk,
    tipo,
    url: dados.click?.link ?? null,
    provider_event_id: providerEventId,
    payload: dados,
    occurred_at: evt.created_at ?? new Date().toISOString(),
  });

  if (tipo === "bounce_hard" || tipo === "complaint") {
    if (emailDestino) {
      await supabase.from("supressao").upsert(
        { email: emailDestino, motivo: tipo === "complaint" ? "complaint" : "hard_bounce", origem_envio_fk: envio.envio_id },
        { onConflict: "email", ignoreDuplicates: true });
    }
    await supabase.from("envios")
      .update({ status: tipo === "complaint" ? "complained" : "bounced" })
      .eq("envio_id", envio.envio_id);
  } else if (tipo === "delivered") {
    await supabase.from("envios").update({ status: "delivered" }).eq("envio_id", envio.envio_id);
  }

  return new Response("ok");
});
