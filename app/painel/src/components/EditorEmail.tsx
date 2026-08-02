import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import presetNewsletter from "grapesjs-preset-newsletter";

// Editor visual de e-mail (GrapesJS, 100% local — nada sai do navegador).
// Salva HTML com o CSS embutido em cada tag (é o que cliente de e-mail
// entende) + o design em JSON, para reeditar depois sem perder a estrutura.
//
// Tudo aqui é montado com <table>: o Outlook ignora boa parte de flex/grid,
// e e-mail quebrado no Outlook é e-mail quebrado para meia lista.

const LARGURA = 600;                            // largura clássica de newsletter
const FONTE = "Arial, Helvetica, sans-serif";   // fonte segura em todo cliente

// Endereço das funções públicas. O contador é uma imagem servida por elas —
// precisa de URL absoluta, porque quem abre o e-mail está fora do painel.
const BASE_FUNCOES = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1`;
const URL_CONTADOR = `${BASE_FUNCOES}/contador`;

// prazo de exemplo: uma semana à frente, só para o bloco nascer mostrando algo
const PRAZO_EXEMPLO = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 19) + "-03:00";

// As cores e a fonte que os blocos trazem de fábrica. Servem de gabarito: o
// que estiver configurado em Ajustes substitui estes valores no momento em
// que o bloco é registrado, e aí todo bloco arrastado já nasce na identidade
// visual certa — sem ninguém precisar repintar nada à mão.
const PADRAO = {
  email_fonte: "Arial, Helvetica, sans-serif",
  email_cor_texto: "#3c3646",
  email_cor_titulo: "#1f1a2e",
  email_cor_destaque: "#6b4ea8",
  email_cor_fundo: "#f4f1ec",
};

const aplicarEstilos = (html: string, estilos: Record<string, string>) => {
  let saida = html;
  for (const [chave, de] of Object.entries(PADRAO)) {
    const para = estilos[chave];
    if (!para || para === de) continue;
    saida = saida.split(de).join(para);
    if (de.startsWith("#")) {                    // o mesmo tom sem o "#" (ex.: contador)
      saida = saida.split(de.slice(1)).join(para.replace("#", ""));
    }
  }
  return saida;
};

const bloco = (interno: string, padding = "8px 24px") =>
  `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
     <td style="padding:${padding};font-family:${FONTE}">${interno}</td>
   </tr></table>`;


// ---- estruturas de coluna ------------------------------------------------
// Coluna de e-mail é <td>, não flex nem grid: o Outlook ignora os dois. E no
// celular cada <td> continua lado a lado — por isso as colunas ganham a
// classe "col-empilha", que a media query do topo empilha abaixo de 480px.
const coluna = (larguras: number[]) => {
  const tds = larguras.map((w) => `
        <td class="col-empilha" width="${w}%" valign="top"
            style="padding:8px;font-family:${FONTE};font-size:15px;line-height:1.6;color:#3c3646">
          Escreva aqui
        </td>`).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:4px 16px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tds}
        </tr></table>
      </td></tr></table>`;
};

const ESTRUTURAS: { id: string; label: string; content: string }[] = [
  { id: "est-1", label: "1 coluna", content: coluna([100]) },
  { id: "est-2", label: "2 colunas", content: coluna([50, 50]) },
  { id: "est-3", label: "3 colunas", content: coluna([33, 34, 33]) },
  { id: "est-4", label: "4 colunas", content: coluna([25, 25, 25, 25]) },
  { id: "est-1-2", label: "1 : 2", content: coluna([33, 67]) },
  { id: "est-2-1", label: "2 : 1", content: coluna([67, 33]) },
];

const BLOCOS: { id: string; label: string; content: string }[] = [
  {
    id: "ress-titulo", label: "Título",
    content: bloco(`<h1 style="margin:0;font-size:26px;line-height:1.3;color:#1f1a2e;font-weight:700">
      Seu título aqui</h1>`),
  },
  {
    id: "ress-texto", label: "Parágrafo",
    content: bloco(`<p style="margin:0;font-size:16px;line-height:1.65;color:#3c3646">
      Olá {{nome}}, escreva seu texto aqui. Frases curtas funcionam melhor no celular,
      que é onde a maioria vai ler.</p>`),
  },
  {
    id: "ress-botao", label: "Botão",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:20px 24px">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="#6b4ea8" style="border-radius:8px">
            <a href="https://" style="display:inline-block;padding:14px 32px;font-family:${FONTE};
               font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">
              Quero participar</a>
          </td></tr></table>
      </td></tr></table>`,
  },
  {
    id: "ress-imagem", label: "Imagem",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:8px 24px">
        <img src="https://placehold.co/552x280/efeae1/6b4ea8?text=sua+imagem" alt=""
             width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px" />
      </td></tr></table>`,
  },
  {
    id: "ress-destaque", label: "Destaque",
    content: bloco(`<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-left:4px solid #6b4ea8;background:#f6f3fb;padding:16px 20px;border-radius:6px">
        <p style="margin:0;font-size:16px;line-height:1.6;color:#3c3646">
          Um recado que não pode passar batido.</p>
      </td></tr></table>`),
  },
  {
    id: "ress-divisor", label: "Divisor",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:12px 24px"><div style="border-top:1px solid #e6e2da;font-size:0;line-height:0">&nbsp;</div></td>
    </tr></table>`,
  },
  {
    id: "ress-espaco", label: "Espaço",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td height="28" style="font-size:0;line-height:0">&nbsp;</td></tr></table>`,
  },
  {
    id: "ress-video", label: "Vídeo",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:12px 24px">
        <a href="https://" style="display:block;text-decoration:none">
          <img src="https://placehold.co/552x310/1f1a2e/ffffff?text=%E2%96%B6" alt="Assistir"
               width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px" />
        </a>
        <div style="font-family:${FONTE};font-size:13px;color:#7a756a;padding-top:6px">
          clique para assistir</div>
      </td></tr></table>`,
  },
  {
    id: "ress-social", label: "Redes sociais",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:16px 24px">
        <a href="https://instagram.com/" style="display:inline-block;padding:0 8px;text-decoration:none;
           font-family:${FONTE};font-size:14px;color:#6b4ea8">Instagram</a>
        <a href="https://youtube.com/" style="display:inline-block;padding:0 8px;text-decoration:none;
           font-family:${FONTE};font-size:14px;color:#6b4ea8">YouTube</a>
        <a href="https://facebook.com/" style="display:inline-block;padding:0 8px;text-decoration:none;
           font-family:${FONTE};font-size:14px;color:#6b4ea8">Facebook</a>
      </td></tr></table>`,
  },
  {
    id: "ress-banner", label: "Banner",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#6b4ea8"><tr>
      <td align="center" style="padding:26px 24px;font-family:${FONTE}">
        <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.35">
          Uma chamada que precisa aparecer</div>
        <div style="font-size:15px;color:#e9e2f7;padding-top:6px;line-height:1.5">
          e uma frase de apoio logo abaixo</div>
      </td></tr></table>`,
  },
  {
    id: "ress-prazo", label: "Prazo (data)",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:18px 24px;font-family:${FONTE}">
        <div style="font-size:13px;color:#7a756a;text-transform:uppercase;letter-spacing:.5px">
          As inscrições encerram em</div>
        <div style="font-size:26px;font-weight:700;color:#1f1a2e;padding-top:4px">
          segunda-feira, 07:00</div>
      </td></tr></table>`,
  },
  {
    id: "ress-menu", label: "Menu de links",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:12px 24px;border-bottom:1px solid #e6e2da;font-family:${FONTE}">
        <a href="https://" style="padding:0 10px;font-size:14px;color:#3c3646;text-decoration:none">Início</a>
        <a href="https://" style="padding:0 10px;font-size:14px;color:#3c3646;text-decoration:none">Cursos</a>
        <a href="https://" style="padding:0 10px;font-size:14px;color:#3c3646;text-decoration:none">Contato</a>
      </td></tr></table>`,
  },
  {
    id: "ress-passos", label: "Lista de passos",
    content: bloco(`<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td valign="top" width="32" style="font-size:16px;font-weight:700;color:#6b4ea8;padding:6px 0">1)</td>
          <td style="font-size:16px;line-height:1.6;color:#3c3646;padding:6px 0">
            <b>Primeiro passo</b> — o que a pessoa precisa fazer agora.</td></tr>
      <tr><td valign="top" style="font-size:16px;font-weight:700;color:#6b4ea8;padding:6px 0">2)</td>
          <td style="font-size:16px;line-height:1.6;color:#3c3646;padding:6px 0">
            <b>Segundo passo</b> — e o seguinte.</td></tr>
      <tr><td valign="top" style="font-size:16px;font-weight:700;color:#6b4ea8;padding:6px 0">3)</td>
          <td style="font-size:16px;line-height:1.6;color:#3c3646;padding:6px 0">
            <b>Terceiro passo</b> — feche com o mais importante.</td></tr>
    </table>`),
  },
  {
    id: "ress-contador", label: "Contador regressivo",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:20px 24px;font-family:${FONTE}">
        <div style="font-size:13px;color:#7a756a;text-transform:uppercase;letter-spacing:.5px;
                    padding-bottom:8px">Falta pouco</div>
        <img src="${URL_CONTADOR}?ate=${PRAZO_EXEMPLO}&cor=6b4ea8&fundo=ffffff"
             alt="tempo restante" width="362"
             style="display:block;margin:0 auto;max-width:100%;height:auto" />
        <div style="font-size:12px;color:#a09a8e;padding-top:6px">
          dias &middot; horas &middot; min &middot; seg</div>
      </td></tr></table>`,
  },
  {
    id: "ress-html", label: "HTML livre",
    content: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:8px 24px;font-family:${FONTE};font-size:15px;color:#3c3646">
        <!-- cole seu HTML aqui -->
        Bloco de HTML livre. Selecione e use "editar código" para colar o seu.
      </td></tr></table>`,
  },
  {
    id: "ress-assinatura", label: "Assinatura",
    content: bloco(`<p style="margin:0;font-size:15px;line-height:1.7;color:#3c3646">
      Um abraço,<br /><b>Nome do Remetente</b><br />
      <span style="color:#7a756a;font-size:13px">Sua Área</span></p>`, "20px 24px"),
  },
];

// o motor entende os dois formatos: o nosso e o herdado do ActiveCampaign
const TAGS = [
  { tag: "{{nome}}", desc: "primeiro nome" },
  { tag: "{{nome_completo}}", desc: "nome completo" },
  { tag: "{{email}}", desc: "e-mail" },
  { tag: "%FIRSTNAME%", desc: "primeiro nome, formato ActiveCampaign" },
];

// Sem isto, uma linha de 4 colunas fica com 138px cada no celular e o texto
// vira uma coluna de letras. Media query em <style> no topo do e-mail é a
// forma que Gmail, Apple Mail e a maioria respeita.
const RESPONSIVO = `<style>
  @media only screen and (max-width:480px) {
    .col-empilha { display:block !important; width:100% !important; }
  }
</style>`;

const envolve = (miolo: string) =>
  `${RESPONSIVO}<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f1ec"><tr>
     <td align="center" style="padding:28px 12px">
       <table width="${LARGURA}" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"
              style="max-width:${LARGURA}px;border-radius:12px">
         <tr><td style="padding:12px 0">${miolo}</td></tr>
       </table>
     </td></tr></table>`;

const B = Object.fromEntries(BLOCOS.map((b) => [b.id, b.content]));

const MODELOS: { nome: string; descricao: string; html: string }[] = [
  {
    nome: "Carta simples",
    descricao: "Só texto, como um e-mail pessoal. É o formato que costuma ter a melhor entrega.",
    html: envolve(B["ress-texto"] + B["ress-assinatura"]),
  },
  {
    nome: "Convite com botão",
    descricao: "Título, texto e uma chamada para ação. Para aulas, lives e lançamentos.",
    html: envolve(B["ress-titulo"] + B["ress-texto"] + B["ress-botao"] + B["ress-assinatura"]),
  },
  {
    nome: "Anúncio com imagem",
    descricao: "Imagem no topo, título, texto, destaque e botão.",
    html: envolve(B["ress-imagem"] + B["ress-titulo"] + B["ress-texto"] +
                  B["ress-destaque"] + B["ress-botao"] + B["ress-assinatura"]),
  },
  {
    nome: "Começar do zero",
    descricao: "Uma folha quase em branco para montar do seu jeito.",
    html: envolve(B["ress-texto"]),
  },
];

export default function EditorEmail({ html, design, onSalvar, onFechar }: {
  html: string;
  design: unknown | null;
  onSalvar: (html: string, design: unknown) => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const inicial = useRef<string>(html);
  const [dispositivo, setDispositivo] = useState<"Desktop" | "Mobile">("Desktop");
  // galeria só aparece quando não há nada escrito ainda
  const [escolhendo, setEscolhendo] = useState(!html && !design);
  const [copiado, setCopiado] = useState("");
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [estilos, setEstilos] = useState<Record<string, string> | null>(null);
  const [modulos, setModulos] = useState<{ modulo_id: string; nome: string; html: string }[]>([]);
  const [ocupado, setOcupado] = useState("");

  // Os estilos precisam chegar ANTES de registrar os blocos — depois já não
  // adianta, o bloco arrastado sairia com a cor de fábrica.
  useEffect(() => {
    Promise.all([
      supabase.from("app_config").select("chave,valor").like("chave", "email_%"),
      supabase.from("email_modulos").select("modulo_id,nome,html").order("nome"),
    ]).then(([cfg, mod]) => {
      setEstilos(Object.fromEntries((cfg.data ?? []).map((r) => [r.chave, r.valor])));
      setModulos(mod.data ?? []);
    });
  }, []);

  useEffect(() => {
    if (!ref.current || escolhendo || !estilos) return;
    const editor = grapesjs.init({
      container: ref.current,
      height: "100%",
      storageManager: false,
      plugins: [presetNewsletter],
      deviceManager: {
        devices: [
          { id: "Desktop", name: "Computador", width: "" },
          { id: "Mobile", name: "Celular", width: "375px", widthMedia: "480px" },
        ],
      },
      assetManager: {
        // O upload vai para o Storage do próprio projeto. Imagem de e-mail
        // precisa de URL pública e estável: quem abre a mensagem não está
        // logado, e o link continua sendo pedido meses depois — link
        // temporário quebraria o e-mail antigo.
        upload: false,          // desligamos o envio padrão; o nosso está abaixo
        autoAdd: true,
        assets: [],
      },
    });

    // ---- envio das imagens para o Storage ----
    editor.on("asset:upload:start", () => setEnviandoImagem(true));
    editor.on("asset:upload:end", () => setEnviandoImagem(false));

    const am = editor.AssetManager;

    // troca o envio padrão do GrapesJS pelo nosso
    editor.on("run:open-assets", () => { /* nada; só garante o registro */ });
    const inputArquivo = () => {
      const el = document.querySelector<HTMLInputElement>("#gjs-am-uploadFile");
      if (!el || el.dataset.ligado) return;
      el.dataset.ligado = "1";
      el.addEventListener("change", async (ev) => {
        const arquivos = (ev.target as HTMLInputElement).files;
        if (!arquivos?.length) return;
        setEnviandoImagem(true);
        for (const arq of Array.from(arquivos)) {
          const nome = `${Date.now()}-${arq.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
          const { error } = await supabase.storage.from("imagens").upload(nome, arq, {
            contentType: arq.type, upsert: false,
          });
          if (error) { alert("Não deu para enviar " + arq.name + ": " + error.message); continue; }
          const { data } = supabase.storage.from("imagens").getPublicUrl(nome);
          am.add({ src: data.publicUrl, name: arq.name });
        }
        setEnviandoImagem(false);
        (ev.target as HTMLInputElement).value = "";
      });
    };
    editor.on("modal:open", () => setTimeout(inputArquivo, 60));

    // carrega o que já foi enviado antes
    supabase.storage.from("imagens").list("", { limit: 200, sortBy: { column: "created_at", order: "desc" } })
      .then(({ data }) => {
        for (const f of data ?? []) {
          if (f.name === ".emptyFolderPlaceholder") continue;
          am.add({ src: supabase.storage.from("imagens").getPublicUrl(f.name).data.publicUrl, name: f.name });
        }
      });

    ESTRUTURAS.forEach((e) => {
      editor.BlockManager.add(e.id, {
        label: e.label, content: aplicarEstilos(e.content, estilos), category: "Estruturas",
      });
    });
    BLOCOS.forEach((b) => {
      editor.BlockManager.add(b.id, {
        label: b.label, content: aplicarEstilos(b.content, estilos), category: "Blocos",
      });
    });
    modulos.forEach((m) => {
      editor.BlockManager.add(`mod-${m.modulo_id}`, {
        label: m.nome, content: m.html, category: "Meus módulos",
      });
    });
    TAGS.forEach((t, i) => {
      editor.BlockManager.add(`ress-tag-${i}`, {
        label: t.tag, content: `<span>${t.tag}</span>`,
        category: "Personalização",
      });
    });

    if (design) {
      try { editor.loadProjectData(design as never); }
      catch { editor.setComponents(inicial.current || MODELOS[0].html); }
    } else {
      editor.setComponents(inicial.current || MODELOS[0].html);
    }
    editorRef.current = editor;
    return () => { editor.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolhendo, estilos, modulos]);

  function trocarDispositivo(d: "Desktop" | "Mobile") {
    setDispositivo(d);
    editorRef.current?.setDevice(d);
  }

  function copiarTag(tag: string) {
    navigator.clipboard?.writeText(tag);
    setCopiado(tag);
    setTimeout(() => setCopiado(""), 1600);
  }

  // ---- guardar o bloco selecionado para reusar em outros e-mails ----
  async function salvarModulo() {
    const sel = editorRef.current?.getSelected();
    if (!sel) { alert("Selecione antes o bloco que você quer guardar."); return; }
    const nome = prompt("Nome do módulo (ex.: Cabeçalho, Assinatura):")?.trim();
    if (!nome) return;
    setOcupado("Guardando módulo…");
    const html = sel.toHTML();
    const { data, error } = await supabase.from("email_modulos")
      .insert({ nome, html }).select("modulo_id,nome,html").single();
    setOcupado("");
    if (error) { alert("Não deu para guardar: " + error.message); return; }
    // entra na lista e o editor se remonta com o módulo já disponível
    setModulos((m) => [...m, data].sort((a, b) => a.nome.localeCompare(b.nome)));
  }

  function salvar() {
    const editor = editorRef.current;
    if (!editor) return;
    let htmlFinal = "";
    try {
      // devolve o HTML com o CSS embutido em cada tag — a única forma que
      // Gmail e Outlook respeitam de verdade
      htmlFinal = editor.runCommand("gjs-get-inlined-html");
    } catch { /* preset ausente */ }
    if (!htmlFinal) {
      htmlFinal = `<!doctype html><html><head><meta charset="utf-8"><style>${editor.getCss()}</style></head><body>${editor.getHtml()}</body></html>`;
    }

    // Media query não pode ser embutida em atributo style — ela precisa
    // viver num <style>. Se o e-mail usa colunas e ainda não tem a regra
    // (por exemplo, um e-mail antigo em que você arrastou uma estrutura),
    // ela entra aqui. Sem isso, 4 colunas no celular viram 4 tiras de 90px
    // e o texto desce letra por letra.
    if (htmlFinal.includes("col-empilha") && !htmlFinal.includes("@media only screen and (max-width:480px)")) {
      htmlFinal = htmlFinal.includes("</head>")
        ? htmlFinal.replace("</head>", `${RESPONSIVO}</head>`)
        : RESPONSIVO + htmlFinal;
    }

    onSalvar(htmlFinal, editor.getProjectData());
  }

  const btn = (ativo: boolean) => ({
    padding: "5px 12px", borderRadius: 6, cursor: "pointer",
    border: `1px solid ${ativo ? "var(--marca)" : "var(--borda)"}`,
    background: ativo ? "var(--marca)" : "transparent",
    color: ativo ? "#fff" : "var(--texto)",
    fontSize: "calc(12.5px * var(--escala-texto))",
  });

  if (escolhendo) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--fundo)", overflow: "auto" }}>
        <div style={{ maxWidth: 940, margin: "0 auto", padding: "40px 20px" }}>
          <h1 style={{ marginBottom: 4 }}>Por onde começar?</h1>
          <div className="sub" style={{ marginBottom: 24 }}>
            Todos já vêm prontos para celular e para o Outlook. Você muda tudo depois.
          </div>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
            {MODELOS.map((m) => (
              <div key={m.nome} className="caixa" style={{ cursor: "pointer", margin: 0 }}
                onClick={() => { inicial.current = m.html; setEscolhendo(false); }}>
                <iframe title={m.nome} srcDoc={m.html} sandbox=""
                  style={{
                    width: "100%", height: 190, border: "1px solid var(--borda)",
                    borderRadius: 8, pointerEvents: "none", background: "#fff",
                  }} />
                <b style={{ display: "block", marginTop: 10 }}>{m.nome}</b>
                <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))", lineHeight: 1.5 }}>
                  {m.descricao}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24 }}>
            <button onClick={onFechar}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        padding: "10px 16px", borderBottom: "1px solid #e6e2da",
      }}>
        <b style={{ fontSize: "calc(14px * var(--escala-texto))" }}>Editor de e-mail</b>

        <div style={{ display: "flex", gap: 6 }}>
          <button style={btn(dispositivo === "Desktop")} onClick={() => trocarDispositivo("Desktop")}>
            🖥 Computador
          </button>
          <button style={btn(dispositivo === "Mobile")} onClick={() => trocarDispositivo("Mobile")}>
            📱 Celular
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#7a756a", fontSize: "calc(12px * var(--escala-texto))" }}>personalizar:</span>
          {TAGS.map((t) => (
            <button key={t.tag} style={btn(copiado === t.tag)} onClick={() => copiarTag(t.tag)}
              title={`${t.desc} — clique para copiar, ou arraste da aba Personalização`}>
              {copiado === t.tag ? "copiado ✓" : t.tag}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button style={btn(false)} onClick={salvarModulo}
            title="Guarda o bloco selecionado para reusar em qualquer e-mail">
            💾 Guardar bloco
          </button>
        </div>

        {(enviandoImagem || ocupado) && (
          <span style={{ color: "var(--marca)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
            {ocupado || "enviando imagem…"}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="primario" onClick={salvar}>Salvar e voltar</button>
          <button onClick={onFechar}>Cancelar</button>
        </div>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
