// Edge Function do RSS. Dois usos:
//
//   GET  /rss?url=https://blog.com/feed&qtd=3   → devolve os posts e um
//        HTML pronto para colar no e-mail (é o que o editor consome)
//
//   POST /rss  {"verificar": true}              → percorre as fontes
//        cadastradas e, para cada post novo, registra o evento
//        rss_novo_item. É o que o cron chama.
//
// O feed é lido com expressão regular, não com parser de XML: o Deno não
// traz DOMParser, e trazer uma biblioteca para ler quatro campos sairia
// mais caro do que vale. Lê RSS 2.0 e Atom, que é o que existe na prática.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

type Item = {
  guid: string; titulo: string; link: string; resumo: string; imagem: string;
};

const semTags = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
   .replace(/<[^>]+>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&#39;|&apos;/g, "'")
   .replace(/\s+/g, " ").trim();

const campo = (bloco: string, ...nomes: string[]): string => {
  for (const n of nomes) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(bloco);
    if (m) return semTags(m[1]);
  }
  return "";
};

function lerFeed(xml: string, limite: number): Item[] {
  const blocos = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const itens: Item[] = [];

  for (const b of blocos.slice(0, limite)) {
    // no Atom o link é atributo, no RSS é conteúdo da tag
    let link = campo(b, "link");
    if (!link) {
      link = /<link[^>]*href=["']([^"']+)["']/i.exec(b)?.[1] ?? "";
    }
    const imagem =
      /<(?:media:content|media:thumbnail|enclosure)[^>]*url=["']([^"']+)["']/i.exec(b)?.[1] ??
      /<img[^>]*src=["']([^"']+)["']/i.exec(b)?.[1] ?? "";

    const resumo = campo(b, "description", "summary", "content:encoded", "content");
    itens.push({
      guid: campo(b, "guid", "id") || link,
      titulo: campo(b, "title"),
      link,
      resumo: resumo.length > 260 ? resumo.slice(0, 257) + "…" : resumo,
      imagem,
    });
  }
  return itens;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// HTML de e-mail: tabela, estilo em linha, nada de flex nem grid.
function montarHtml(itens: Item[]): string {
  const F = "Arial, Helvetica, sans-serif";
  const cartoes = itens.map((i) => `
      <tr><td style="padding:0 24px 18px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border:1px solid #e6e2da;border-radius:8px">
          ${i.imagem ? `<tr><td><a href="${esc(i.link)}"><img src="${esc(i.imagem)}" alt=""
             width="100%" style="display:block;width:100%;height:auto;border-radius:8px 8px 0 0"
             /></a></td></tr>` : ""}
          <tr><td style="padding:14px 16px;font-family:${F}">
            <a href="${esc(i.link)}" style="font-size:17px;font-weight:700;color:#1f1a2e;
               text-decoration:none;line-height:1.35">${esc(i.titulo)}</a>
            ${i.resumo ? `<div style="font-size:14px;line-height:1.6;color:#3c3646;padding-top:6px">
               ${esc(i.resumo)}</div>` : ""}
            <a href="${esc(i.link)}" style="display:inline-block;margin-top:10px;font-size:14px;
               color:#6b4ea8;text-decoration:none;font-weight:700">Ler o post &rarr;</a>
          </td></tr>
        </table>
      </td></tr>`).join("");

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">${cartoes}</table>`;
}

async function buscar(url: string, qtd: number) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Ressoa/1.0 (leitor de RSS)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`feed respondeu ${r.status}`);
  return lerFeed(await r.text(), qtd);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const u = new URL(req.url);

  // ---------- modo leitura (editor) ----------
  if (req.method === "GET") {
    const alvo = u.searchParams.get("url");
    const qtd = Math.min(10, Math.max(1, Number(u.searchParams.get("qtd") ?? 3)));
    if (!alvo) {
      return new Response(JSON.stringify({ erro: "informe ?url=" }), { status: 400, headers: cors });
    }
    // só http(s): a URL vem do painel, mas nada custa fechar a porta
    if (!/^https?:\/\//i.test(alvo)) {
      return new Response(JSON.stringify({ erro: "url inválida" }), { status: 400, headers: cors });
    }
    try {
      const itens = await buscar(alvo, qtd);
      return new Response(JSON.stringify({ ok: true, itens, html: montarHtml(itens) }),
                          { headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ erro: String(e) }), { status: 502, headers: cors });
    }
  }

  // ---------- modo verificação (cron) ----------
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const cab = {
    "Content-Type": "application/json",
    apikey: chave,
    Authorization: `Bearer ${chave}`,
  };

  const fontes = await (await fetch(
    `${base}/rest/v1/rss_fontes?ativo=eq.true&select=fonte_id,url,ultimo_guid`,
    { headers: cab })).json();

  const relato: unknown[] = [];
  for (const f of fontes) {
    try {
      const itens = await buscar(f.url, 1);
      if (!itens.length) { relato.push({ fonte: f.fonte_id, nota: "feed vazio" }); continue; }
      const i = itens[0];
      if (i.guid === f.ultimo_guid) { relato.push({ fonte: f.fonte_id, nota: "sem novidade" }); continue; }

      const r = await fetch(`${base}/rest/v1/rpc/rss_registrar_item`, {
        method: "POST", headers: cab,
        body: JSON.stringify({
          p_fonte: f.fonte_id, p_guid: i.guid, p_titulo: i.titulo,
          p_link: i.link, p_resumo: i.resumo, p_imagem: i.imagem,
        }),
      });
      relato.push({ fonte: f.fonte_id, post: i.titulo, avisados: await r.json() });
    } catch (e) {
      relato.push({ fonte: f.fonte_id, erro: String(e) });
    }
  }
  return new Response(JSON.stringify({ ok: true, fontes: fontes.length, relato }),
                      { headers: cors });
});
