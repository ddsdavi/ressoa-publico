// Ponte com o ManyChat.
//
// Recebe um contato da Ressoa, procura essa pessoa no ManyChat e aplica a
// tag. Se não achar e a automação pedir, cria o assinante antes.
//
// A chave da API não vive aqui nem no .env: vive na tabela de segredos do
// banco, e é trocável pela tela de Configurações. Assim a Patrícia troca a
// chave sozinha, sem redeploy e sem ninguém precisar ver o valor.
//
// Ordem da busca: e-mail primeiro, WhatsApp depois. E-mail é o que a
// Ressoa sempre tem; telefone falta em boa parte da base.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

const MC = "https://api.manychat.com/fb";

type Corpo = {
  lead_id?: string; email?: string; nome?: string;
  whatsapp?: string; tag?: string; criar?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const cab = { "Content-Type": "application/json", apikey: chave,
                Authorization: `Bearer ${chave}` };

  // service_role passa por cima do RLS — é assim que a função lê um segredo
  // que o navegador não consegue ler
  const seg = await (await fetch(
    `${base}/rest/v1/segredos?chave=eq.manychat_api_key&select=valor`,
    { headers: cab })).json();
  const token = seg?.[0]?.valor;

  const registrar = async (lead: string | undefined, acao: string, tag: string,
                           ok: boolean, detalhe: string) => {
    await fetch(`${base}/rest/v1/manychat_log`, {
      method: "POST", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({ lead_fk: lead ?? null, acao, tag, sucesso: ok, detalhe }),
    });
  };

  if (!token) {
    return new Response(JSON.stringify({ erro: "chave do ManyChat não configurada" }),
                        { status: 400, headers: CORS });
  }

  const mc = async (caminho: string, metodo = "GET", corpo?: unknown) => {
    const r = await fetch(`${MC}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const texto = await r.text();
    let dados: Record<string, unknown> = {};
    try { dados = JSON.parse(texto); } catch { dados = { bruto: texto.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, dados };
  };

  // ---- só conferir a chave (o painel usa isto no botão "testar") ----
  const u = new URL(req.url);
  if (req.method === "GET" || u.searchParams.get("acao") === "testar") {
    const r = await mc("/page/getTags");
    const tags = (r.dados as { data?: { name: string }[] })?.data ?? [];
    return new Response(JSON.stringify({
      ok: r.ok,
      mensagem: r.ok ? `chave válida — ${tags.length} tag(s) na conta` : "chave recusada pelo ManyChat",
      tags: tags.map((t) => t.name).slice(0, 50),
    }), { status: r.ok ? 200 : 400, headers: CORS });
  }

  const c = (await req.json().catch(() => ({}))) as Corpo;
  if (!c.tag) {
    return new Response(JSON.stringify({ erro: "informe a tag" }), { status: 400, headers: CORS });
  }

  // ---- 1. achar a pessoa ----
  let id: number | null = null;
  if (c.email) {
    const r = await mc(`/subscriber/findBySystemField?email=${encodeURIComponent(c.email)}`);
    id = (r.dados as { data?: { id: number } })?.data?.id ?? null;
  }
  if (!id && c.whatsapp) {
    const fone = c.whatsapp.replace(/\D/g, "");
    if (fone.length >= 10) {
      const r = await mc(`/subscriber/findBySystemField?phone=${encodeURIComponent("+55" + fone)}`);
      id = (r.dados as { data?: { id: number } })?.data?.id ?? null;
    }
  }

  // ---- 2. criar, se for o caso ----
  let criado = false;
  if (!id && c.criar !== false) {
    const partes = (c.nome ?? "").trim().split(/\s+/);
    const r = await mc("/subscriber/createSubscriber", "POST", {
      first_name: partes[0] || "Contato",
      last_name: partes.slice(1).join(" ") || "",
      email: c.email,
      phone: c.whatsapp ? "+55" + c.whatsapp.replace(/\D/g, "") : undefined,
      has_opt_in_email: true,
      consent_phrase: "inscrito na base da Ressoa",
    });
    id = (r.dados as { data?: { id: number } })?.data?.id ?? null;
    criado = !!id;
    if (!id) {
      await registrar(c.lead_id, "criar", c.tag, false, JSON.stringify(r.dados).slice(0, 400));
      return new Response(JSON.stringify({ erro: "não deu para criar o assinante", detalhe: r.dados }),
                          { status: 400, headers: CORS });
    }
  }

  if (!id) {
    await registrar(c.lead_id, "buscar", c.tag, false, "não encontrado e não foi pedido para criar");
    return new Response(JSON.stringify({ ok: false, motivo: "assinante não existe no ManyChat" }),
                        { headers: CORS });
  }

  // ---- 3. aplicar a tag ----
  // addTagByName cria a tag se ela ainda não existir na conta, então não é
  // preciso cadastrá-la antes no ManyChat
  const r = await mc("/subscriber/addTagByName", "POST",
                     { subscriber_id: id, tag_name: c.tag });
  await registrar(c.lead_id, criado ? "criou e marcou" : "marcou", c.tag, r.ok,
                  r.ok ? `assinante ${id}` : JSON.stringify(r.dados).slice(0, 400));

  return new Response(JSON.stringify({ ok: r.ok, assinante: id, criado }),
                      { status: r.ok ? 200 : 400, headers: CORS });
});
