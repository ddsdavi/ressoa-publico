// Ponte com o ManyChat.
//
// A pessoa é encontrada por um CAMPO PERSONALIZADO que guarda o WhatsApp
// dela — não por campo de sistema. Isso não é preferência: numa conta que
// recebe gente pelo WhatsApp e pelo Instagram, "email" e "phone" chegam
// vazios, e findBySystemField não acha ninguém. O número de verdade fica
// num campo personalizado (aqui chamado WHATSAPP-ID), preenchido por uma
// automação do próprio ManyChat quando a pessoa entra.
//
// O id desse campo muda de conta para conta, então vive em app_config
// (manychat_campo_whatsapp), não no código.
//
// Duas coisas que custaram depuração:
//   - "data" vem como LISTA nas buscas. Ler data.id devolve undefined
//     mesmo quando encontrou.
//   - addTagByName NÃO cria a tag: responde "Tag does not exist" e não faz
//     nada. É preciso criar antes com /page/createTag.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

const MC = "https://api.manychat.com/fb";

type Corpo = {
  lead_id?: string; manychat_id?: string; email?: string; nome?: string;
  whatsapp?: string; tag?: string; criar?: boolean;
  subscriber_id?: string | number; registrar?: boolean;
  // operações avulsas usadas pela tela
  acao?: "tags" | "criar_tag" | "procurar" | "criar" | "desmarcar";
};

// ---------------------------------------------------------------------
// Formatação do telefone
// ---------------------------------------------------------------------
// O ManyChat guarda o número num formato só, e a busca é exata: um dígito
// de diferença e a pessoa "não existe". As regras abaixo são as mesmas do
// n8n que já roda em produção — vale mantê-las iguais, porque números
// gravados por lá precisam ser encontrados por aqui.
export function formatarTelefone(bruto: string): string {
  const n = String(bruto ?? "").replace(/\D+/g, "");
  if (!n) return "";

  // celular brasileiro com DDI: 55 + DDD + 9 + 8 dígitos
  if (n.length === 13 && n.startsWith("55")) return n;

  // fixo brasileiro com DDI: falta o 9
  if (n.length === 12 && n.startsWith("55")) return n.slice(0, 4) + "9" + n.slice(4);

  // estrangeiro já com DDI (Portugal, Argentina, Alemanha…)
  if (n.length >= 12) return n;

  // celular brasileiro sem DDI — o 9 na terceira casa é o que o denuncia
  if (n.length === 11 && n[2] === "9") return "55" + n;

  // 11 dígitos sem esse 9: provavelmente estrangeiro (EUA, por exemplo)
  if (n.length === 11) return n;

  // fixo brasileiro sem DDI: entra o 55 e o 9
  if (n.length === 10) return "55" + n.slice(0, 2) + "9" + n.slice(2);

  return "";     // curto demais para ser telefone
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const cab = { "Content-Type": "application/json", apikey: chave,
                Authorization: `Bearer ${chave}` };

  const seg = await (await fetch(
    `${base}/rest/v1/segredos?chave=eq.manychat_api_key&select=valor`,
    { headers: cab })).json();
  const token = seg?.[0]?.valor;

  const cfg = await (await fetch(
    `${base}/rest/v1/app_config?chave=eq.manychat_campo_whatsapp&select=valor`,
    { headers: cab })).json();
  const campoWhats = cfg?.[0]?.valor ?? "";

  const anotar = async (lead: string | undefined, acao: string, tag: string,
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

  // "data" é lista nas buscas e objeto na criação — aceita os dois
  const primeiro = (d: unknown): number | null => {
    const dados = (d as { data?: unknown })?.data;
    if (Array.isArray(dados)) {
      return dados.length ? Number((dados[0] as { id: number }).id) : null;
    }
    const um = dados as { id?: number } | undefined;
    return um?.id ? Number(um.id) : null;
  };

  const u = new URL(req.url);

  // ---- conferir a chave (botão "testar" do painel) ----
  if (req.method === "GET" || u.searchParams.get("acao") === "testar") {
    const r = await mc("/page/getTags");
    const tags = (r.dados as { data?: { name: string }[] })?.data ?? [];
    return new Response(JSON.stringify({
      ok: r.ok,
      mensagem: r.ok
        ? `chave válida — ${tags.length} tag(s) na conta` +
          (campoWhats ? "" : ". Falta informar o campo do WhatsApp em Configurações.")
        : "chave recusada pelo ManyChat",
      campo_whatsapp: campoWhats || null,
      tags: tags.map((t) => t.name).slice(0, 50),
    }), { status: r.ok ? 200 : 400, headers: CORS });
  }

  const c = (await req.json().catch(() => ({}))) as Corpo;

  // ---- operações avulsas, para a tela do painel ----
  //
  // São as mesmas chamadas que a automação faz, só que uma de cada vez e
  // com a resposta crua. É o que permite conferir antes de ligar um fluxo
  // que vai mandar WhatsApp para gente de verdade.
  if (c.acao) {
    const fone = formatarTelefone(c.whatsapp ?? "");

    if (c.acao === "tags") {
      const r = await mc("/page/getTags");
      const tags = ((r.dados as { data?: { id: number; name: string }[] })?.data ?? [])
        .sort((a, b) => a.name.localeCompare(b.name));
      return new Response(JSON.stringify({ ok: r.ok, tags }), { headers: CORS });
    }

    if (c.acao === "criar_tag") {
      const nome = (c.tag ?? "").trim();
      if (!nome) {
        return new Response(JSON.stringify({ ok: false, erro: "informe o nome da tag" }),
                            { status: 400, headers: CORS });
      }
      const r = await mc("/page/createTag", "POST", { name: nome });
      const jaExiste = JSON.stringify(r.dados).includes("already exist");
      return new Response(JSON.stringify({
        ok: r.ok || jaExiste,
        mensagem: r.ok ? `tag "${nome}" criada` : jaExiste ? `"${nome}" já existia` : "não deu para criar",
        detalhe: r.ok || jaExiste ? undefined : r.dados,
      }), { headers: CORS });
    }

    if (c.acao === "procurar") {
      if (!fone) {
        return new Response(JSON.stringify({ ok: false, erro: "telefone inválido", formatado: null }),
                            { status: 400, headers: CORS });
      }
      if (!campoWhats) {
        return new Response(JSON.stringify({ ok: false, erro: "falta o id do campo do WhatsApp" }),
                            { status: 400, headers: CORS });
      }
      const r = await mc(
        `/subscriber/findByCustomField?field_id=${encodeURIComponent(campoWhats)}` +
        `&field_value=${encodeURIComponent(fone)}`);
      const achados = ((r.dados as { data?: Record<string, unknown>[] })?.data ?? []);
      const p = achados[0];
      return new Response(JSON.stringify({
        ok: true, formatado: fone, existe: !!p,
        assinante: p ? {
          id: p.id, nome: p.name, status: p.status,
          whatsapp: p.whatsapp_phone,
          tags: ((p.tags ?? []) as { name: string }[]).map((t) => t.name),
        } : null,
      }), { headers: CORS });
    }

    if (c.acao === "criar") {
      if (!fone) {
        return new Response(JSON.stringify({ ok: false, erro: "sem WhatsApp válido não dá para criar" }),
                            { status: 400, headers: CORS });
      }
      const partes = (c.nome ?? "").trim().split(/\s+/);
      const r = await mc("/subscriber/createSubscriber", "POST", {
        first_name: partes[0] || "Contato",
        last_name: partes.slice(1).join(" ") || "",
        whatsapp_phone: fone,
        has_opt_in_sms: true,
        has_opt_in_email: true,
        consent_phrase: "cadastro vindo da Ressoa",
      });
      const id = primeiro(r.dados);
      await anotar(c.lead_id, "criou pela tela", "", !!id,
                   id ? `assinante ${id}` : JSON.stringify(r.dados).slice(0, 300));
      return new Response(JSON.stringify({
        ok: !!id, assinante: id, formatado: fone,
        detalhe: id ? undefined : r.dados,
      }), { headers: CORS });
    }

    if (c.acao === "desmarcar") {
      const r = await mc("/subscriber/removeTagByName", "POST",
                         { subscriber_id: Number(c.manychat_id), tag_name: c.tag });
      await anotar(c.lead_id, "desmarcou", c.tag ?? "", r.ok, JSON.stringify(r.dados).slice(0, 200));
      return new Response(JSON.stringify({ ok: r.ok, detalhe: r.ok ? undefined : r.dados }),
                          { headers: CORS });
    }

    return new Response(JSON.stringify({ erro: "ação desconhecida: " + c.acao }),
                        { status: 400, headers: CORS });
  }

  // ---- o ManyChat nos apresentando alguém (ação External Request) ----
  if (c.subscriber_id || c.registrar) {
    const r = await fetch(`${base}/rest/v1/rpc/manychat_registrar`, {
      method: "POST", headers: cab,
      body: JSON.stringify({
        p_manychat_id: String(c.subscriber_id ?? ""),
        p_email: c.email ?? null,
        p_whatsapp: c.whatsapp ?? null,
        p_nome: c.nome ?? null,
      }),
    });
    const d = await r.json();
    await anotar(d?.lead, "registrou", "", !!d?.ok, JSON.stringify(d).slice(0, 300));
    return new Response(JSON.stringify(d), { status: r.ok ? 200 : 400, headers: CORS });
  }

  if (!c.tag) {
    return new Response(JSON.stringify({ erro: "informe a tag" }), { status: 400, headers: CORS });
  }

  const fone = formatarTelefone(c.whatsapp ?? "");

  // ---- 1. achar ----
  let id: number | null = c.manychat_id ? Number(c.manychat_id) : null;
  let como = id ? "id guardado" : "";

  if (!id && campoWhats && fone) {
    id = primeiro((await mc(
      `/subscriber/findByCustomField?field_id=${encodeURIComponent(campoWhats)}` +
      `&field_value=${encodeURIComponent(fone)}`)).dados);
    if (id) como = "campo do WhatsApp";
  }

  // último recurso, e quase sempre em vão nesta conta: campo de sistema
  if (!id && c.email) {
    id = primeiro((await mc(
      `/subscriber/findBySystemField?email=${encodeURIComponent(c.email)}`)).dados);
    if (id) como = "e-mail";
  }

  // ---- 2. criar ----
  // Sem telefone não cria: um assinante de WhatsApp sem número é um
  // registro que nunca vai receber nada e ainda suja a base de lá.
  let criado = false;
  if (!id && c.criar !== false) {
    if (!fone) {
      await anotar(c.lead_id, "criar", c.tag, false, "sem WhatsApp — não dá para criar");
      return new Response(JSON.stringify({ ok: false, motivo: "contato sem WhatsApp" }),
                          { headers: CORS });
    }
    const partes = (c.nome ?? "").trim().split(/\s+/);
    const r = await mc("/subscriber/createSubscriber", "POST", {
      first_name: partes[0] || "Contato",
      last_name: partes.slice(1).join(" ") || "",
      whatsapp_phone: fone,
      has_opt_in_sms: true,
      has_opt_in_email: true,
      consent_phrase: "cadastro vindo da Ressoa",
    });
    id = primeiro(r.dados);
    criado = !!id;
    como = "criado agora";
    if (!id) {
      await anotar(c.lead_id, "criar", c.tag, false, JSON.stringify(r.dados).slice(0, 400));
      return new Response(JSON.stringify({ ok: false, erro: "não deu para criar", detalhe: r.dados }),
                          { status: 400, headers: CORS });
    }
  }

  if (!id) {
    await anotar(c.lead_id, "buscar", c.tag, false, "não encontrado e não foi pedido para criar");
    return new Response(JSON.stringify({ ok: false, motivo: "assinante não existe no ManyChat" }),
                        { headers: CORS });
  }

  // ---- 3. marcar ----
  // Tenta aplicar e só cria a tag ao esbarrar no erro: o caso comum é ela
  // já existir, e criar antes gastaria uma chamada em toda marcação.
  let r = await mc("/subscriber/addTagByName", "POST",
                   { subscriber_id: id, tag_name: c.tag });
  if (!r.ok && JSON.stringify(r.dados).includes("Tag does not exist")) {
    await mc("/page/createTag", "POST", { name: c.tag });
    r = await mc("/subscriber/addTagByName", "POST",
                 { subscriber_id: id, tag_name: c.tag });
  }

  // achou uma vez, não procura de novo
  if (r.ok && c.lead_id && !c.manychat_id) {
    await fetch(`${base}/rest/v1/tabela_1_leads?lead_id=eq.${c.lead_id}`, {
      method: "PATCH", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({ manychat_id: String(id) }),
    });
  }

  await anotar(c.lead_id, criado ? "criou e marcou" : "marcou", c.tag, r.ok,
               r.ok ? `assinante ${id} (${como})` : JSON.stringify(r.dados).slice(0, 400));

  return new Response(JSON.stringify({ ok: r.ok, assinante: id, criado, como }),
                      { status: r.ok ? 200 : 400, headers: CORS });
});
