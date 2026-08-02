// Edge Function: postbacks do Amazon SES, que chegam via SNS.
//
// O SES não faz POST direto como o Resend: ele publica num tópico SNS, e o
// SNS chama esta função. Duas diferenças que quebram quem não sabe:
//
//   1. A primeira chamada é uma CONFIRMAÇÃO de inscrição. Se ninguém abrir
//      a SubscribeURL que vem nela, o tópico nunca envia mais nada — e
//      tudo parece funcionar até você reparar que nenhum bounce chegou.
//
//   2. O conteúdo vem como TEXTO dentro de outro JSON (campo Message),
//      então precisa de dois parses.
//
// Bounce permanente e reclamação alimentam a supressão automaticamente,
// igual ao caminho do Resend.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAPA: Record<string, string> = {
  Send: "sent",
  Delivery: "delivered",
  DeliveryDelay: "deferred",
  Bounce: "bounce_hard",
  Complaint: "complaint",
  Open: "open",
  Click: "click",
  Reject: "rejected",
};

// pega o nosso identificador do envio, que viaja no cabeçalho do MIME
function refDoEnvio(mail: Record<string, any>): string | null {
  const h = mail?.headers;
  if (Array.isArray(h)) {
    const achado = h.find((x: Record<string, string>) =>
      (x?.name ?? "").toLowerCase() === "x-entity-ref-id");
    if (achado?.value) return achado.value;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const bruto = await req.text();
  let sns: Record<string, any>;
  try {
    sns = JSON.parse(bruto);
  } catch {
    return new Response("corpo inválido", { status: 400 });
  }

  // ---- 1. confirmação da inscrição no tópico ----
  if (sns.Type === "SubscriptionConfirmation" && sns.SubscribeURL) {
    // aceitar só URLs da AWS: SubscribeURL vem do corpo, e corpo é dado,
    // não instrução. Sem esta checagem, quem descobrisse o endereço da
    // função poderia fazer o servidor chamar qualquer URL.
    if (!/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(sns.SubscribeURL)) {
      console.error("SubscribeURL fora da AWS, ignorada:", sns.SubscribeURL);
      return new Response("url não confiável", { status: 400 });
    }
    const r = await fetch(sns.SubscribeURL);
    console.log("inscrição no tópico SNS confirmada:", r.status);
    return new Response("inscrição confirmada");
  }

  if (sns.Type === "UnsubscribeConfirmation") return new Response("ok");

  // ---- 2. o evento em si, embrulhado em texto ----
  let evt: Record<string, any>;
  try {
    evt = typeof sns.Message === "string" ? JSON.parse(sns.Message) : (sns.Message ?? sns);
  } catch {
    return new Response("mensagem inválida", { status: 400 });
  }

  const tipoSes = evt.eventType ?? evt.notificationType;
  const tipo = MAPA[tipoSes];
  if (!tipo) return new Response("evento ignorado: " + tipoSes);

  const mail = evt.mail ?? {};
  const destinos: string[] = mail.destination ?? [];
  const email = (destinos[0] ?? "").toLowerCase();
  const ref = refDoEnvio(mail);

  // localiza o envio: pelo nosso identificador, ou pelo último para aquele
  // endereço. O identificador é mais confiável — o e-mail pode ter recebido
  // vários envios e o mais recente não ser o que gerou este evento.
  let envio: { envio_id: string; lead_fk: string } | null = null;
  if (ref) {
    const { data } = await supabase.from("envios")
      .select("envio_id, lead_fk").eq("envio_id", ref).maybeSingle();
    envio = data ?? null;
  }
  if (!envio && email) {
    const { data } = await supabase.from("envios")
      .select("envio_id, lead_fk, tabela_1_leads!inner(email)")
      .eq("tabela_1_leads.email", email)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    envio = data ? { envio_id: data.envio_id, lead_fk: data.lead_fk } : null;
  }

  // ---- 3. bounce e reclamação bloqueiam, mesmo sem achar o envio ----
  // Bounce leve (mailbox cheia) não bloqueia: o endereço existe e volta a
  // funcionar. Bloquear por isso seria perder a pessoa para sempre.
  const permanente = tipoSes === "Bounce" && evt.bounce?.bounceType === "Permanent";
  const reclamou = tipoSes === "Complaint";

  if ((permanente || reclamou) && email) {
    await supabase.from("supressao").upsert(
      { email, motivo: reclamou ? "complaint" : "hard_bounce",
        origem_envio_fk: envio?.envio_id ?? null },
      { onConflict: "email", ignoreDuplicates: true });
  }

  if (envio) {
    await supabase.from("eventos_email").insert({
      envio_fk: envio.envio_id,
      lead_fk: envio.lead_fk,
      tipo: permanente ? "bounce_hard" : tipo === "bounce_hard" ? "bounce_soft" : tipo,
      url: evt.click?.link ?? null,
      occurred_at: mail.timestamp ?? new Date().toISOString(),
      payload: { ses: tipoSes, sub: evt.bounce?.bounceSubType ?? null },
    });

    if (tipo === "delivered") {
      await supabase.from("envios").update({ status: "delivered" }).eq("envio_id", envio.envio_id);
    } else if (permanente) {
      await supabase.from("envios").update({ status: "bounced" }).eq("envio_id", envio.envio_id);
    } else if (reclamou) {
      await supabase.from("envios").update({ status: "complained" }).eq("envio_id", envio.envio_id);
    }
  } else {
    console.warn("evento do SES sem envio correspondente:", tipoSes, email);
  }

  return new Response(JSON.stringify({ ok: true, tipo }), {
    headers: { "Content-Type": "application/json" },
  });
});
