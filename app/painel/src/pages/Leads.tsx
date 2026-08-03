import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { parseCsv, adivinharColuna } from "../lib/csv";
import { useSessao } from "../lib/sessao";
import { useSearchParams } from "react-router-dom";
import ManyChatLeadDrawer, { type LeadParaManyChat } from "../components/ManyChatLeadDrawer";

type Lead = {
  lead_pontuacao?: { pontos: number } | { pontos: number }[] | null;
  lead_id: string; nome: string | null; email: string | null;
  whatsapp: string | null; cpf: string | null; created_at: string;
};

type Envio = {
  envio_id: string; status: string; sent_at: string | null; queued_at: string;
  provider: string | null; mensagens: { nome: string; subject: string } | null;
};

type Evento = { quando: string; tipo: string; titulo: string; detalhe: string | null };
type Nota = { nota_id: string; autor_email: string | null; texto: string; created_at: string };

type Detalhe = {
  listas: { nome: string; status: number }[];
  tags: string[];
  participacoes: { evento_origem: string; created_at: string }[];
  atributos: Record<string, string>;
  suprimido: boolean;
  envios: Envio[];
};

type Segmento = { segmento_id: string; nome: string; definicao: Record<string, any> };
type Cond = Record<string, any>;

const ICONE_TEMPO: Record<string, string> = {
  lista: "📋", tag: "🏷", evento: "🎟", compra: "💰", envio: "✉",
  open: "👁", click: "🔗", delivered: "✅", bounce_hard: "⚠",
  complaint: "🚫", automacao: "⚙", bloqueio: "⛔", nota: "📝",
};

const STATUS_LISTA: Record<number, [string, string]> = {
  0: ["não confirmado", "et-cinza"],
  1: ["ativo", "et-verde"],
  2: ["descadastrado", "et-amarela"],
  3: ["bounce", "et-vermelha"],
};

const STATUS_ENVIO: Record<string, string> = {
  queued: "et-amarela", sent: "et-roxa", delivered: "et-verde",
  bounced: "et-vermelha", complained: "et-vermelha", failed: "et-vermelha",
  suppressed: "et-cinza",
};

const CAMPOS_COND: [string, string][] = [
  ["lista", "Está numa lista"],
  ["tag", "Tem a tag"],
  ["whatsapp", "WhatsApp"],
  ["busca", "Texto (email/nome/fone)"],
  ["email_dominio", "Domínio do e-mail"],
  ["participacao", "Participou de evento"],
  ["atributo", "Campo personalizado"],
  ["abriu_email", "Abriu e-mail (últimos N dias)"],
  ["clicou_email", "Clicou em e-mail (últimos N dias)"],
  ["nao_suprimido", "Não está na supressão"],
  ["pontuacao", "Pontuação do lead"],
  ["comprou", "Comprou (produto opcional)"],
  ["qtd_compras", "Quantidade de compras"],
  ["total_gasto", "Total gasto (R$)"],
  ["pediu_reembolso", "Pediu reembolso"],
];



export default function Leads() {
  const { ehAdmin, podeOperar, podePreparar } = useSessao();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState("");
  const [fLista, setFLista] = useState("");
  const [fStatusLista, setFStatusLista] = useState("");
  const [fTag, setFTag] = useState("");
  const [fWhatsapp, setFWhatsapp] = useState("");
  const [pagina, setPagina] = useState(0);
  const [POR_PAGINA, setPorPagina] = useState(25);
  const [total, setTotal] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [tags, setTags] = useState<{ tag_id: number; nome: string }[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [segAvancado, setSegAvancado] = useState<{ nome: string; ids: string[] } | null>(null);
  const [sel, setSel] = useState<Lead | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [tempo, setTempo] = useState<Evento[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [novaNota, setNovaNota] = useState("");
  const [nomeCsv, setNomeCsv] = useState("");
  const [recarga, setRecarga] = useState(0);   // força releitura após ação em massa
  const [det, setDet] = useState<Detalhe | null>(null);
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState({ nome: "", email: "", whatsapp: "" });
  const [ocupado, setOcupado] = useState(false);
  const [acaoMassa, setAcaoMassa] = useState("");
  const [manyChatLead, setManyChatLead] = useState<LeadParaManyChat | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [textoExclusao, setTextoExclusao] = useState("");
  const [excluindoLead, setExcluindoLead] = useState(false);
  const [erroExclusao, setErroExclusao] = useState("");
  const [mensagemPagina, setMensagemPagina] = useState("");

  // construtor de segmento avançado
  const [construtor, setConstrutor] = useState(false);
  const [conds, setConds] = useState<Cond[]>([{ campo: "lista" }]);
  const [condOp, setCondOp] = useState<"and" | "or">("and");
  const [prevQtd, setPrevQtd] = useState<number | null>(null);

  // importação CSV
  const [importando, setImportando] = useState(false);
  const [csv, setCsv] = useState<{ cabecalho: string[]; linhas: string[][] } | null>(null);
  const [mapa, setMapa] = useState({ email: -1, nome: -1, whatsapp: -1, cpf: -1 });
  const [impLista, setImpLista] = useState("");
  const [impTag, setImpTag] = useState("");
  const [progresso, setProgresso] = useState("");

  // filtros vindos de Listas/Tags (ex.: /leads?lista=17&status=1)
  useEffect(() => {
    const pLista = params.get("lista"), pTag = params.get("tag"), pStatus = params.get("status");
    const pBusca = params.get("busca");             // vem da tela de Envios/supressão
    if (pBusca) {
      setBusca(pBusca);
      setSegAvancado(null);
      setPagina(0);
      setParams({}, { replace: true });
      return;
    }
    if (pLista || pTag) {
      setFLista(pLista ?? "");
      setFStatusLista(pStatus ?? "");
      setFTag(pTag ?? "");
      setSegAvancado(null);
      setPagina(0);
      setParams({}, { replace: true });
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [l, t] = await Promise.all([
        supabase.from("listas").select("lista_id, nome").order("nome"),
        supabase.from("tags").select("tag_id, nome").order("nome"),
      ]);
      setListas(l.data ?? []);
      setTags((t.data ?? []) as never);
      carregarSegmentos();
    })();
  }, []);

  async function carregarSegmentos() {
    const { data } = await supabase.from("segmentos").select("*").order("nome");
    setSegmentos((data as never) ?? []);
  }

  function montarQuery(paraContagem = false) {
    let seletor = "lead_id, nome, email, whatsapp, cpf, created_at";
    if (fLista) seletor += ", lead_listas!inner(lista_fk, status)";
    if (fTag) seletor += ", lead_tags!inner(tag_fk)";
    let q = supabase.from("tabela_1_leads")
      .select(seletor, { count: "exact", head: paraContagem });
    if (fLista) {
      q = q.eq("lead_listas.lista_fk", Number(fLista));
      if (fStatusLista !== "") q = q.eq("lead_listas.status", Number(fStatusLista));
    }
    if (fTag) q = q.eq("lead_tags.tag_fk", Number(fTag));
    if (fWhatsapp === "com") q = q.not("whatsapp", "is", null);
    if (fWhatsapp === "sem") q = q.is("whatsapp", null);
    if (busca.trim()) {
      const b = busca.trim();
      q = q.or(`email.ilike.%${b}%,nome.ilike.%${b}%,whatsapp.ilike.%${b}%`);
    }
    return q;
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      if (segAvancado) {
        const fatia = segAvancado.ids.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
        const { data } = await supabase.from("tabela_1_leads")
          .select("lead_id, nome, email, whatsapp, cpf, created_at, lead_pontuacao(pontos)")
          .in("lead_id", fatia);
        setLeads((data as never) ?? []);
        setTotal(segAvancado.ids.length);
        return;
      }
      const { data, count, error } = await montarQuery()
        .order("created_at", { ascending: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) { console.error(error); return; }
      setLeads((data as never) ?? []);
      setTotal(count ?? 0);
    }, 300);
    return () => clearTimeout(t);
  }, [busca, fLista, fStatusLista, fTag, fWhatsapp, pagina, segAvancado, POR_PAGINA, recarga]);

  // ---------- segmentos ----------
  function definicaoAtual(): Record<string, unknown> {
    const def: Record<string, unknown> = {};
    if (fLista) def.lista_id = Number(fLista);
    if (fLista && fStatusLista !== "") def.status_lista = Number(fStatusLista);
    if (fTag) def.tag_id = Number(fTag);
    if (fWhatsapp) def.whatsapp = fWhatsapp;
    if (busca.trim()) def.busca = busca.trim();
    return def;
  }

  async function salvarSegmentoRapido() {
    const def = definicaoAtual();
    if (!Object.keys(def).length) { alert("Configure algum filtro antes de salvar como segmento."); return; }
    const nome = prompt("Nome do segmento:");
    if (!nome?.trim()) return;
    const { error } = await supabase.from("segmentos").insert({ nome: nome.trim(), definicao: def });
    if (error) { alert(error.message); return; }
    carregarSegmentos();
  }

  async function aplicarSegmento(id: string) {
    const s = segmentos.find((x) => x.segmento_id === id);
    if (!s) return;
    const d = s.definicao;
    if (d.condicoes) {
      // segmento avançado: resolve no banco e lista por ids
      setOcupado(true);
      const { data, error } = await supabase.rpc("leads_do_segmento", { p_def: d });
      setOcupado(false);
      if (error) { alert(error.message); return; }
      const ids = ((data as any[]) ?? []).map((r) => (typeof r === "string" ? r : r.leads_do_segmento));
      setSegAvancado({ nome: s.nome, ids });
      setPagina(0);
      return;
    }
    setSegAvancado(null);
    setFLista(d.lista_id ? String(d.lista_id) : "");
    setFStatusLista(d.status_lista !== undefined ? String(d.status_lista) : "");
    setFTag(d.tag_id ? String(d.tag_id) : "");
    setFWhatsapp((d.whatsapp as string) ?? "");
    setBusca((d.busca as string) ?? "");
    setPagina(0);
  }

  async function excluirSegmento(id: string) {
    const s = segmentos.find((x) => x.segmento_id === id);
    if (!s || !confirm(`Excluir o segmento "${s.nome}"? (campanhas que o usam perdem a audiência)`)) return;
    await supabase.from("segmentos").delete().eq("segmento_id", id);
    carregarSegmentos();
  }

  // ---------- construtor avançado ----------
  function defAvancada(): Record<string, unknown> {
    return { op: condOp, condicoes: conds.filter((c) => c.campo) };
  }

  async function contarConstrutor() {
    setPrevQtd(null);
    const { data, error } = await supabase.rpc("contar_segmento", { p_def: defAvancada() });
    if (error) { alert(error.message); return; }
    setPrevQtd(data ?? 0);
  }

  async function salvarConstrutor() {
    const nome = prompt("Nome do segmento avançado:");
    if (!nome?.trim()) return;
    const { error } = await supabase.from("segmentos").insert({ nome: nome.trim(), definicao: defAvancada() });
    if (error) { alert(error.message); return; }
    await carregarSegmentos();
    alert("Segmento salvo — disponível aqui e nas Campanhas.");
  }

  async function aplicarConstrutor() {
    setOcupado(true);
    const { data, error } = await supabase.rpc("leads_do_segmento", { p_def: defAvancada() });
    setOcupado(false);
    if (error) { alert(error.message); return; }
    const ids = ((data as any[]) ?? []).map((r) => (typeof r === "string" ? r : r.leads_do_segmento));
    setSegAvancado({ nome: "(construtor)", ids });
    setPagina(0);
    setConstrutor(false);
  }

  function mudarCond(i: number, patch: Cond) {
    setConds(conds.map((c, x) => (x === i ? { ...c, ...patch } : c)));
  }

  // ---------- ações em massa / export ----------
  async function idsDoFiltro(limite = 20000): Promise<string[]> {
    if (segAvancado) return segAvancado.ids.slice(0, limite);
    const ids: string[] = [];
    for (let p = 0; ids.length < limite; p++) {
      const { data } = await montarQuery()
        .order("created_at", { ascending: false })
        .range(p * 1000, p * 1000 + 999);
      const lote = (data as never as Lead[]) ?? [];
      ids.push(...lote.map((l) => l.lead_id));
      if (lote.length < 1000) break;
    }
    return ids;
  }

  function alternarMarcado(id: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  const todosDaPaginaMarcados = leads.length > 0 && leads.every((l) => marcados.has(l.lead_id));

  // A acao vale para quem esta marcado; sem ninguem marcado, vale para o
  // filtro inteiro. E a diferenca entre "estes 3" e "todos os 11 mil" — por
  // isso o texto da confirmacao sempre diz qual dos dois esta em jogo.
  async function executarAcaoMassa() {
    if (!acaoMassa) return;
    const [tipo, valor] = acaoMassa.split(":");
    const naSelecao = marcados.size > 0;
    const quantos = naSelecao ? marcados.size : total;

    const nomeTag = () => tags.find((t) => t.tag_id === Number(valor))?.nome;
    const nomeLista = () => listas.find((l) => l.lista_id === Number(valor))?.nome;
    const rotulo: Record<string, string> = {
      tag: 'aplicar a tag "' + nomeTag() + '"',
      destag: 'REMOVER a tag "' + nomeTag() + '"',
      lista: 'inscrever na lista "' + nomeLista() + '"',
      deslista: 'DESCADASTRAR da lista "' + nomeLista() + '"',
      suprimir: "BLOQUEAR o envio para sempre",
    };
    const alvo = naSelecao
      ? "nos " + quantos + " leads marcados"
      : "em TODOS os " + quantos + " leads do filtro atual";
    if (!confirm(rotulo[tipo] + " " + alvo + "?")) return;

    // bloquear e irreversivel na pratica: quem entra aqui nao recebe mais
    // nada, e depois nao da para saber quem foi bloqueado por engano
    if (tipo === "suprimir") {
      const frase = prompt(
        "Isto impede QUALQUER e-mail futuro para " + quantos + " pessoas.\n\n" +
        "Para confirmar, digite BLOQUEAR:");
      if (frase !== "BLOQUEAR") return;
    }

    setOcupado(true);
    const ids = naSelecao ? [...marcados] : await idsDoFiltro();

    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      if (tipo === "tag") {
        await supabase.from("lead_tags").upsert(
          chunk.map((lead_fk) => ({ lead_fk, tag_fk: Number(valor) })),
          { onConflict: "lead_fk,tag_fk", ignoreDuplicates: true });
      } else if (tipo === "destag") {
        await supabase.from("lead_tags").delete()
          .eq("tag_fk", Number(valor)).in("lead_fk", chunk);
      } else if (tipo === "lista") {
        await supabase.from("lead_listas").upsert(
          chunk.map((lead_fk) => ({ lead_fk, lista_fk: Number(valor), status: 1, source: "painel_massa" })),
          { onConflict: "lead_fk,lista_fk", ignoreDuplicates: true });
      } else if (tipo === "deslista") {
        // status 2 = descadastrado. O vinculo nao e apagado: o historico de
        // que a pessoa esteve na lista continua valendo para os relatorios.
        await supabase.from("lead_listas")
          .update({ status: 2, updated_at: new Date().toISOString() })
          .eq("lista_fk", Number(valor)).in("lead_fk", chunk);
      } else if (tipo === "suprimir") {
        const { data } = await supabase.from("tabela_1_leads")
          .select("email").in("lead_id", chunk).not("email", "is", null);
        const emails = ((data ?? []) as { email: string }[]).map((r) => r.email);
        if (emails.length) {
          await supabase.from("supressao").upsert(
            emails.map((email) => ({ email, motivo: "manual" })),
            { onConflict: "email", ignoreDuplicates: true });
        }
      }
    }

    setOcupado(false);
    setAcaoMassa("");
    setMarcados(new Set());
    setRecarga((n) => n + 1);
    alert("Feito para " + ids.length + " leads. (Gatilhos de automacao disparam normalmente.)");
  }

  async function exportarCsv() {
    // Export no padrão do ActiveCampaign: ID, Lista, Email, Nome, Sobrenome,
    // Telefone, Status, Data da criação, campos personalizados dinâmicos, Tags.
    setOcupado(true);
    const coletados: Lead[] = [];
    if (segAvancado) {
      for (let i = 0; i < segAvancado.ids.length; i += 500) {
        const { data } = await supabase.from("tabela_1_leads")
          .select("lead_id, nome, email, whatsapp, cpf, created_at")
          .in("lead_id", segAvancado.ids.slice(i, i + 500));
        coletados.push(...(((data as never) ?? []) as Lead[]));
      }
    } else {
      for (let p = 0; ; p++) {
        const { data } = await montarQuery()
          .order("created_at", { ascending: false })
          .range(p * 1000, p * 1000 + 999);
        const lote = (data as never as Lead[]) ?? [];
        coletados.push(...lote);
        if (lote.length < 1000) break;
      }
    }

    // enriquece: tags, listas com status e atributos, em lotes
    const tagsPor: Record<string, string[]> = {};
    const listasPor: Record<string, string[]> = {};
    const attrsPor: Record<string, Record<string, string>> = {};
    const rotuloStatus: Record<number, string> = { 0: "Não confirmado", 1: "Ativo", 2: "Descadastrado", 3: "Bounce" };
    for (let i = 0; i < coletados.length; i += 500) {
      const ids = coletados.slice(i, i + 500).map((l) => l.lead_id);
      const [lt, ll, la] = await Promise.all([
        supabase.from("lead_tags").select("lead_fk, tags(nome)").in("lead_fk", ids),
        supabase.from("lead_listas").select("lead_fk, status, listas(nome)").in("lead_fk", ids),
        supabase.from("lead_atributos").select("lead_fk, dados").in("lead_fk", ids),
      ]);
      for (const r of (lt.data as any[]) ?? []) {
        (tagsPor[r.lead_fk] ??= []).push(r.tags?.nome);
      }
      for (const r of (ll.data as any[]) ?? []) {
        (listasPor[r.lead_fk] ??= []).push(`${r.listas?.nome} (${rotuloStatus[r.status] ?? r.status})`);
      }
      for (const r of (la.data as any[]) ?? []) {
        attrsPor[r.lead_fk] = r.dados ?? {};
      }
    }
    const colunasAttr = [...new Set(Object.values(attrsPor).flatMap((d) => Object.keys(d)))].sort();

    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cab = ["ID", "Email", "Nome", "Sobrenome", "Número de telefone", "CPF",
      "Listas (status)", "Data da criação", ...colunasAttr, "Tags"];
    const linhas = [cab.map(q).join(",")];
    for (const l of coletados) {
      const partes = (l.nome ?? "").trim().split(/\s+/);
      const attrs = attrsPor[l.lead_id] ?? {};
      linhas.push([
        l.lead_id, l.email ?? "", partes[0] ?? "", partes.slice(1).join(" "),
        l.whatsapp ?? "", l.cpf ?? "",
        (listasPor[l.lead_id] ?? []).sort().join(", "),
        l.created_at,
        ...colunasAttr.map((k) => attrs[k] ?? ""),
        (tagsPor[l.lead_id] ?? []).sort().join(","),
      ].map(q).join(","));
    }
    const blob = new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    const nomeArquivo = `leads_${carimbo}.csv`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nomeArquivo;
    a.click();

    // registrar: exportar 12 mil contatos e tirar dado pessoal do sistema.
    // Fica o rastro de quem levou, quando e com que filtro (LGPD).
    try {
      const { data: u } = await supabase.auth.getUser();
      const caminho = `${carimbo}_${Math.random().toString(36).slice(2, 8)}.csv`;
      const envio = await supabase.storage.from("exportacoes")
        .upload(caminho, blob, { contentType: "text/csv", upsert: false });
      const expira = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      await supabase.from("operacoes_dados").insert({
        direcao: "exportacao",
        nome: segAvancado ? `Segmento: ${segAvancado.nome}` : (rotuloDoFiltro() || "Base completa"),
        autor_email: u.user?.email ?? null,
        total: coletados.length,
        status: "completo",
        filtro: definicaoAtual(),
        arquivo: envio.error ? null : caminho,
        expira_em: envio.error ? null : expira,
        finalizado_em: new Date().toISOString(),
      });
    } catch { /* o download já aconteceu; o registro é secundário */ }
    setOcupado(false);
  }

  // descreve o filtro atual em uma linha, para o registro fazer sentido depois
  function rotuloDoFiltro(): string {
    const partes: string[] = [];
    if (fLista) partes.push("lista " + (listas.find((l) => l.lista_id === Number(fLista))?.nome ?? fLista));
    if (fTag) partes.push("tag " + (tags.find((t) => t.tag_id === Number(fTag))?.nome ?? fTag));
    if (fWhatsapp) partes.push(fWhatsapp === "com" ? "com WhatsApp" : "sem WhatsApp");
    if (busca.trim()) partes.push(`busca "${busca.trim()}"`);
    return partes.join(" · ");
  }

  // ---------- importação CSV ----------
  function aoEscolherArquivo(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    if (!arquivo) return;
    setNomeCsv(arquivo.name);
    const leitor = new FileReader();
    leitor.onload = () => {
      const dados = parseCsv(String(leitor.result ?? ""));
      setCsv(dados);
      setMapa({
        email: adivinharColuna(dados.cabecalho, "email"),
        nome: adivinharColuna(dados.cabecalho, "nome"),
        whatsapp: adivinharColuna(dados.cabecalho, "whatsapp"),
        cpf: adivinharColuna(dados.cabecalho, "cpf"),
      });
    };
    leitor.readAsText(arquivo, "utf-8");
  }

  async function executarImportacao() {
    if (!csv) return;
    if (mapa.email < 0 && mapa.whatsapp < 0) {
      alert("Mapeie ao menos a coluna de e-mail ou a de WhatsApp.");
      return;
    }
    if (!confirm(`Importar ${csv.linhas.length} linhas? Leads existentes (mesmo WhatsApp ou e-mail) serão atualizados, não duplicados.`)) return;
    setOcupado(true);
    const objetos = csv.linhas.map((l) => ({
      email: mapa.email >= 0 ? l[mapa.email] : null,
      nome: mapa.nome >= 0 ? l[mapa.nome] : null,
      whatsapp: mapa.whatsapp >= 0 ? l[mapa.whatsapp] : null,
      cpf: mapa.cpf >= 0 ? l[mapa.cpf] : null,
    }));
    let ins = 0, upd = 0, inv = 0;
    for (let i = 0; i < objetos.length; i += 500) {
      const chunk = objetos.slice(i, i + 500);
      const { data, error } = await supabase.rpc("importar_leads", {
        p_leads: chunk,
        p_lista: impLista ? Number(impLista) : null,
        p_tag: impTag ? Number(impTag) : null,
      });
      if (error) { alert("Erro no lote " + (i / 500 + 1) + ": " + error.message); break; }
      ins += data?.inseridos ?? 0; upd += data?.atualizados ?? 0; inv += data?.invalidos ?? 0;
      setProgresso(`${Math.min(i + 500, objetos.length)}/${objetos.length} — ${ins} novos, ${upd} atualizados, ${inv} inválidos`);
    }
    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("operacoes_dados").insert({
        direcao: "importacao",
        nome: nomeCsv || "Importação por CSV",
        autor_email: u.user?.email ?? null,
        total: ins + upd,
        falhas: inv,
        status: "completo",
        detalhes: {
          inseridos: ins, atualizados: upd, invalidos: inv,
          lista: impLista ? listas.find((l) => l.lista_id === Number(impLista))?.nome : null,
          tag: impTag ? tags.find((t) => t.tag_id === Number(impTag))?.nome : null,
        },
        finalizado_em: new Date().toISOString(),
      });
    } catch { /* a importação já aconteceu; o registro é secundário */ }
    setOcupado(false);
    setProgresso(`Concluído: ${ins} novos, ${upd} atualizados, ${inv} inválidos/duplicados.`);
  }

  async function criarLead() {
    const email = novo.email.trim().toLowerCase();
    if (!email) { alert("E-mail é obrigatório."); return; }
    const { error } = await supabase.from("tabela_1_leads").insert({
      nome: novo.nome.trim() || null, email,
      whatsapp: novo.whatsapp.replace(/\D/g, "") || null,
    });
    if (error) { alert(error.message); return; }
    setCriando(false); setNovo({ nome: "", email: "", whatsapp: "" });
    setBusca(email);
  }

  async function recarregarNotas(leadId: string) {
    const { data } = await supabase.from("lead_notas")
      .select("nota_id, autor_email, texto, created_at")
      .eq("lead_fk", leadId).order("created_at", { ascending: false });
    setNotas(((data as never) ?? []) as Nota[]);
  }

  async function salvarNota() {
    const texto = novaNota.trim();
    if (!texto || !sel) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("lead_notas").insert({
      lead_fk: sel.lead_id, texto, autor_email: u.user?.email ?? null,
    });
    if (error) { alert(error.message); return; }
    setNovaNota("");
    recarregarNotas(sel.lead_id);
    supabase.rpc("linha_do_tempo", { p_lead: sel.lead_id, p_limite: 120 })
      .then(({ data }) => setTempo(((data as never) ?? []) as Evento[]));
  }

  async function apagarNota(id: string) {
    if (!sel || !confirm("Apagar esta anotação?")) return;
    await supabase.from("lead_notas").delete().eq("nota_id", id);
    recarregarNotas(sel.lead_id);
  }

  async function abrir(l: Lead) {
    setTempo([]); setNotas([]); setNovaNota("");
    setConfirmandoExclusao(false); setTextoExclusao(""); setErroExclusao("");
    supabase.rpc("linha_do_tempo", { p_lead: l.lead_id, p_limite: 120 })
      .then(({ data }) => setTempo(((data as never) ?? []) as Evento[]));
    recarregarNotas(l.lead_id);
    setSel(l);
    setDet(null);
    const [listasQ, tagsQ, parts, attrs, sup, env] = await Promise.all([
      supabase.from("lead_listas").select("status, listas(nome)").eq("lead_fk", l.lead_id),
      supabase.from("lead_tags").select("tags(nome)").eq("lead_fk", l.lead_id),
      supabase.from("tabela_2_participacoes").select("evento_origem, created_at")
        .eq("lead_fk", l.lead_id).order("created_at"),
      supabase.from("lead_atributos").select("dados").eq("lead_fk", l.lead_id).maybeSingle(),
      l.email
        ? supabase.from("supressao").select("email").ilike("email", l.email).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("envios").select("envio_id, status, sent_at, queued_at, provider, mensagens(nome, subject)")
        .eq("lead_fk", l.lead_id).order("queued_at", { ascending: false }).limit(20),
    ]);
    setDet({
      listas: (listasQ.data ?? []).map((x: any) => ({ nome: x.listas?.nome, status: x.status })),
      tags: (tagsQ.data ?? []).map((x: any) => x.tags?.nome).filter(Boolean),
      participacoes: parts.data ?? [],
      atributos: (attrs.data?.dados ?? {}) as Record<string, string>,
      suprimido: !!(sup as any).data,
      envios: (env.data as never) ?? [],
    });
  }

  function fecharDetalhe() {
    setSel(null);
    setDet(null);
    setConfirmandoExclusao(false);
    setTextoExclusao("");
    setErroExclusao("");
  }

  async function excluirLeadSelecionado() {
    if (!sel || textoExclusao !== "EXCLUIR" || excluindoLead) return;

    const leadExcluido = sel;
    setExcluindoLead(true);
    setErroExclusao("");
    const { error } = await supabase.rpc("excluir_lead_ressoa", {
      p_lead_id: leadExcluido.lead_id,
    });
    setExcluindoLead(false);

    if (error) {
      setErroExclusao(error.message);
      return;
    }

    setLeads((atuais) => atuais.filter((lead) => lead.lead_id !== leadExcluido.lead_id));
    setMarcados((atuais) => {
      const proximos = new Set(atuais);
      proximos.delete(leadExcluido.lead_id);
      return proximos;
    });
    setSegAvancado((atual) => atual
      ? { ...atual, ids: atual.ids.filter((id) => id !== leadExcluido.lead_id) }
      : null);
    if (pagina > 0 && leads.length === 1) setPagina(pagina - 1);
    setMensagemPagina(`Lead ${leadExcluido.nome || leadExcluido.email || leadExcluido.whatsapp || "sem nome"} excluído da Ressoa.`);
    fecharDetalhe();
    setRecarga((valor) => valor + 1);
  }

  const paginas = Math.ceil(total / POR_PAGINA);

  return (
    <div>
      <h1>Leads</h1>
      <div className="sub">{total.toLocaleString("pt-BR")} leads no filtro atual</div>

      {mensagemPagina && (
        <div className="aviso sucesso" role="status">
          {mensagemPagina}
          <button onClick={() => setMensagemPagina("")}>fechar</button>
        </div>
      )}

      {segAvancado && (
        <div className="aviso">
          Mostrando o segmento avançado <b>{segAvancado.nome}</b> ({segAvancado.ids.length.toLocaleString("pt-BR")} leads).{" "}
          <button onClick={() => { setSegAvancado(null); setPagina(0); }}>limpar</button>
        </div>
      )}

      <div className="caixa">
        <div className="linha">
          <input placeholder="Buscar por e-mail, nome ou WhatsApp…" value={busca}
            onChange={(e) => { setBusca(e.target.value); setSegAvancado(null); setPagina(0); }} />
          {podePreparar && <>
            <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => setCriando(!criando)}>+ Novo lead</button>
            <button style={{ flex: "0 0 auto" }} onClick={() => { setImportando(true); setCsv(null); setProgresso(""); }}>⬆ Importar CSV</button>
          </>}
        </div>
        {criando && (
          <div className="linha" style={{ marginTop: 10 }}>
            <input placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            <input placeholder="E-mail *" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            <input placeholder="WhatsApp (com DDI)" value={novo.whatsapp} onChange={(e) => setNovo({ ...novo, whatsapp: e.target.value })} />
            <button className="primario" style={{ flex: "0 0 auto" }} onClick={criarLead}>Salvar</button>
          </div>
        )}
        <div className="linha" style={{ marginTop: 10 }}>
          <select value={fLista} onChange={(e) => { setFLista(e.target.value); setSegAvancado(null); setPagina(0); }}>
            <option value="">Lista: todas</option>
            {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
          </select>
          <select value={fStatusLista} disabled={!fLista}
            onChange={(e) => { setFStatusLista(e.target.value); setPagina(0); }}>
            <option value="">Status na lista: qualquer</option>
            <option value="1">ativo</option>
            <option value="2">descadastrado</option>
            <option value="3">bounce</option>
            <option value="0">não confirmado</option>
          </select>
          <select value={fTag} onChange={(e) => { setFTag(e.target.value); setSegAvancado(null); setPagina(0); }}>
            <option value="">Tag: todas</option>
            {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
          </select>
          <select value={fWhatsapp} onChange={(e) => { setFWhatsapp(e.target.value); setSegAvancado(null); setPagina(0); }}>
            <option value="">WhatsApp: tanto faz</option>
            <option value="com">com WhatsApp</option>
            <option value="sem">sem WhatsApp</option>
          </select>
        </div>
        <div className="linha" style={{ marginTop: 10 }}>
          <select onChange={(e) => { if (e.target.value) aplicarSegmento(e.target.value); e.target.value = ""; }}>
            <option value="">Segmentos salvos…</option>
            {segmentos.map((s) => (
              <option key={s.segmento_id} value={s.segmento_id}>
                {s.nome}{s.definicao?.condicoes ? " (avançado)" : ""}
              </option>
            ))}
          </select>
          <button style={{ flex: "0 0 auto" }} onClick={salvarSegmentoRapido}>💾 Salvar filtro</button>
          <button className="primario" style={{ flex: "0 0 auto" }}
            onClick={() => { setConstrutor(true); setPrevQtd(null); }}>🧩 Segmento avançado</button>
          {segmentos.length > 0 && (
            <select style={{ flex: "0 0 auto", width: 170 }}
              onChange={(e) => { if (e.target.value) excluirSegmento(e.target.value); e.target.value = ""; }}>
              <option value="">excluir segmento…</option>
              {segmentos.map((s) => <option key={s.segmento_id} value={s.segmento_id}>{s.nome}</option>)}
            </select>
          )}
        </div>
        {podeOperar && <div className="linha" style={{ marginTop: 10 }}>
          <select value={acaoMassa} onChange={(e) => setAcaoMassa(e.target.value)}>
            <option value="">{marcados.size > 0
              ? `Ação nos ${marcados.size} marcados…`
              : "Ação em massa no filtro atual…"}</option>
            <optgroup label="Aplicar tag">
              {tags.map((t) => <option key={`t${t.tag_id}`} value={`tag:${t.tag_id}`}>+ tag: {t.nome}</option>)}
            </optgroup>
            <optgroup label="Remover tag">
              {tags.map((t) => <option key={`dt${t.tag_id}`} value={`destag:${t.tag_id}`}>&minus; tag: {t.nome}</option>)}
            </optgroup>
            <optgroup label="Inscrever na lista">
              {listas.map((l) => <option key={`l${l.lista_id}`} value={`lista:${l.lista_id}`}>+ lista: {l.nome}</option>)}
            </optgroup>
            <optgroup label="Descadastrar da lista">
              {listas.map((l) => <option key={`dl${l.lista_id}`} value={`deslista:${l.lista_id}`}>&minus; lista: {l.nome}</option>)}
            </optgroup>
            <optgroup label="Bloquear envio">
              <option value="suprimir:0">Nunca mais enviar para estes leads</option>
            </optgroup>
          </select>
          <button disabled={!acaoMassa || ocupado} onClick={executarAcaoMassa} style={{ flex: "0 0 auto" }}>
            {ocupado ? "Executando…" : "Executar"}
          </button>
          <button disabled={ocupado} onClick={exportarCsv} style={{ flex: "0 0 auto" }}>⬇ Exportar CSV</button>
          {marcados.size > 0 && (
            <button style={{ flex: "0 0 auto" }} onClick={() => setMarcados(new Set())}>
              desmarcar {marcados.size}
            </button>
          )}
        </div>}
      </div>

      <div className="caixa">
        <table>
          <thead><tr>
            {podeOperar && (
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={todosDaPaginaMarcados}
                  title="marcar todos desta página"
                  onChange={(e) => {
                    const marcar = e.target.checked;
                    setMarcados((m) => {
                      const n = new Set(m);
                      leads.forEach((l) => marcar ? n.add(l.lead_id) : n.delete(l.lead_id));
                      return n;
                    });
                  }} />
              </th>
            )}
            <th>Nome</th><th>E-mail</th><th>WhatsApp</th><th>Pontos</th><th>Entrou em</th>
            {podeOperar && <th style={{ width: 104 }}>ManyChat</th>}
          </tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.lead_id} className="clicavel" onClick={() => abrir(l)}
                style={marcados.has(l.lead_id) ? { background: "rgba(107,78,168,.09)" } : undefined}>
                {podeOperar && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={marcados.has(l.lead_id)}
                      onChange={() => alternarMarcado(l.lead_id)} />
                  </td>
                )}
                <td>{l.nome || <span style={{ color: "var(--texto2)" }}>—</span>}</td>
                <td>{l.email}</td>
                <td>{l.whatsapp || "—"}</td>
                <td>{(() => {
                  const p = Array.isArray(l.lead_pontuacao) ? l.lead_pontuacao[0] : l.lead_pontuacao;
                  const n = p?.pontos;
                  if (n === undefined || n === null) return <span style={{ color: "var(--texto2)" }}>—</span>;
                  const cor = n >= 40 ? "et-verde" : n >= 20 ? "et-roxa"
                    : n >= 8 ? "et-amarela" : n >= 1 ? "et-cinza" : "et-vermelha";
                  return <span className={`etiqueta ${cor}`}>{n}</span>;
                })()}</td>
                <td>{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                {podeOperar && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="botao-manychat" onClick={() => setManyChatLead(l)}>
                      ManyChat
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="paginacao">
          <span>Linhas:</span>
          <select style={{ width: 90 }} value={POR_PAGINA}
            onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0); }}>
            {[10, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>{total.toLocaleString("pt-BR")} leads</span>
          <button disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
          <span>página {pagina + 1} de {paginas || 1}</span>
          <button disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
        </div>
      </div>

      {construtor && (
        <div className="gaveta" style={{ width: 640 }}>
          <button className="fechar" onClick={() => setConstrutor(false)}>✕</button>
          <h2>Segmento avançado</h2>
          <div className="sub">Combine quantas condições quiser — como a pesquisa avançada do AC.</div>
          <label>Combinar condições com</label>
          <div className="linha" style={{ marginBottom: 10 }}>
            <button className={condOp === "and" ? "primario" : ""} onClick={() => setCondOp("and")}>E (todas)</button>
            <button className={condOp === "or" ? "primario" : ""} onClick={() => setCondOp("or")}>OU (qualquer)</button>
          </div>
          {conds.map((c, i) => (
            <div key={i} className="caixa" style={{ padding: 12, marginBottom: 10 }}>
              <div className="linha">
                <select value={c.campo}
                  onChange={(e) => setConds(conds.map((x, y) => (y === i ? { campo: e.target.value } : x)))}>
                  {CAMPOS_COND.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
                {["lista", "tag", "participacao", "abriu_email", "clicou_email",
                  "comprou", "pediu_reembolso"].includes(c.campo) && (
                  <select value={String(c.tem ?? "true")} style={{ flex: "0 0 130px" }}
                    onChange={(e) => mudarCond(i, { tem: e.target.value === "true" })}>
                    <option value="true">tem / sim</option>
                    <option value="false">NÃO tem</option>
                  </select>
                )}
                {c.campo === "comprou" && (
                  <input style={{ flex: 1 }} placeholder="parte do nome do produto (vazio = qualquer)"
                    value={c.produto ?? ""} onChange={(e) => mudarCond(i, { produto: e.target.value })} />
                )}
                {(c.campo === "qtd_compras" || c.campo === "total_gasto") && (
                  <>
                    <select value={c.operador ?? "maior"} style={{ flex: "0 0 150px" }}
                      onChange={(e) => mudarCond(i, { operador: e.target.value })}>
                      <option value="maior">é maior ou igual a</option>
                      <option value="menor">é menor ou igual a</option>
                    </select>
                    <input type="number" style={{ flex: "0 0 120px" }}
                      placeholder={c.campo === "qtd_compras" ? "2" : "500"}
                      value={c.valor ?? ""} onChange={(e) => mudarCond(i, { valor: e.target.value })} />
                  </>
                )}
                {c.campo === "pontuacao" && (
                  <>
                    <select value={c.operador ?? "maior"} style={{ flex: "0 0 150px" }}
                      onChange={(e) => mudarCond(i, { operador: e.target.value })}>
                      <option value="maior">é maior ou igual a</option>
                      <option value="menor">é menor ou igual a</option>
                    </select>
                    <input type="number" style={{ flex: "0 0 110px" }} placeholder="40"
                      value={c.valor ?? ""} onChange={(e) => mudarCond(i, { valor: e.target.value })} />
                  </>
                )}
                {c.campo === "whatsapp" && (
                  <select value={String(c.tem ?? "true")} style={{ flex: "0 0 130px" }}
                    onChange={(e) => mudarCond(i, { tem: e.target.value === "true" })}>
                    <option value="true">tem</option>
                    <option value="false">não tem</option>
                  </select>
                )}
                <button className="perigo" style={{ flex: "0 0 auto" }}
                  onClick={() => setConds(conds.filter((_, y) => y !== i))}>remover</button>
              </div>
              <div className="linha" style={{ marginTop: 8 }}>
                {c.campo === "lista" && (
                  <>
                    <select value={c.lista_id ?? ""} onChange={(e) => mudarCond(i, { lista_id: Number(e.target.value) })}>
                      <option value="">— lista —</option>
                      {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
                    </select>
                    <select value={c.status ?? ""} onChange={(e) => mudarCond(i, { status: e.target.value === "" ? undefined : Number(e.target.value) })}>
                      <option value="">status: qualquer</option>
                      <option value="1">ativo</option>
                      <option value="2">descadastrado</option>
                      <option value="3">bounce</option>
                    </select>
                  </>
                )}
                {c.campo === "tag" && (
                  <select value={c.tag_id ?? ""} onChange={(e) => mudarCond(i, { tag_id: Number(e.target.value) })}>
                    <option value="">— tag —</option>
                    {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
                  </select>
                )}
                {["busca", "email_dominio", "participacao"].includes(c.campo) && (
                  <input placeholder={c.campo === "email_dominio" ? "gmail.com" : c.campo === "participacao" ? "parte do nome do evento (ex.: CASA_H_2026)" : "texto"}
                    value={c.valor ?? ""} onChange={(e) => mudarCond(i, { valor: e.target.value })} />
                )}
                {c.campo === "atributo" && (
                  <>
                    <input placeholder="nome do campo (ex.: Cidade)" value={c.chave ?? ""}
                      onChange={(e) => mudarCond(i, { chave: e.target.value })} />
                    <input placeholder="valor contém…" value={c.valor ?? ""}
                      onChange={(e) => mudarCond(i, { valor: e.target.value })} />
                  </>
                )}
                {["abriu_email", "clicou_email"].includes(c.campo) && (
                  <input type="number" placeholder="dias (ex.: 30)" value={c.dias ?? ""}
                    onChange={(e) => mudarCond(i, { dias: Number(e.target.value) })} />
                )}
              </div>
            </div>
          ))}
          <button onClick={() => setConds([...conds, { campo: "tag" }])}>+ Adicionar condição</button>
          <div className="linha" style={{ marginTop: 16 }}>
            <button onClick={contarConstrutor}>🔢 Contar</button>
            <button onClick={aplicarConstrutor} disabled={ocupado}>👁 Ver leads</button>
            <button className="primario" onClick={salvarConstrutor}>💾 Salvar segmento</button>
          </div>
          {prevQtd !== null && (
            <div className="sub" style={{ marginTop: 10 }}>
              <b>{prevQtd.toLocaleString("pt-BR")}</b> leads atendem essas condições agora.
            </div>
          )}
        </div>
      )}

      {importando && (
        <div className="gaveta" style={{ width: 620 }}>
          <button className="fechar" onClick={() => setImportando(false)}>✕</button>
          <h2>Importar leads por CSV</h2>
          <div className="sub">Mesma lógica do AC: quem já existe (WhatsApp ou e-mail) é atualizado, nunca duplicado. Números ganham DDI 55 automaticamente.</div>
          <label>Arquivo CSV (separado por ; , ou tab)</label>
          <input type="file" accept=".csv,text/csv" onChange={aoEscolherArquivo} />
          {csv && (
            <>
              <div className="sub" style={{ marginTop: 10 }}>
                {csv.linhas.length.toLocaleString("pt-BR")} linhas · colunas: {csv.cabecalho.join(" · ")}
              </div>
              <h2 style={{ marginTop: 12 }}>Mapeamento de colunas</h2>
              {(["email", "nome", "whatsapp", "cpf"] as const).map((campo) => (
                <div key={campo} className="linha" style={{ marginTop: 6 }}>
                  <label style={{ flex: "0 0 90px", margin: 0 }}>{campo}</label>
                  <select value={mapa[campo]}
                    onChange={(e) => setMapa({ ...mapa, [campo]: Number(e.target.value) })}>
                    <option value={-1}>— não importar —</option>
                    {csv.cabecalho.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
              <h2 style={{ marginTop: 14 }}>Aplicar a todos os importados (opcional)</h2>
              <div className="linha">
                <select value={impLista} onChange={(e) => setImpLista(e.target.value)}>
                  <option value="">Inscrever na lista: nenhuma</option>
                  {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
                </select>
                <select value={impTag} onChange={(e) => setImpTag(e.target.value)}>
                  <option value="">Aplicar tag: nenhuma</option>
                  {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
                </select>
              </div>
              {(impLista || impTag) && (
                <div className="aviso" style={{ marginTop: 10 }}>
                  Atenção: inscrever na lista/tag dispara as automações correspondentes (e-mails em modo simulado; webhooks só se a chave-geral estiver ligada).
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <button className="primario" disabled={ocupado} onClick={executarImportacao}>
                  {ocupado ? "Importando…" : `Importar ${csv.linhas.length.toLocaleString("pt-BR")} linhas`}
                </button>
              </div>
              {progresso && <div className="sub" style={{ marginTop: 10 }}>{progresso}</div>}
            </>
          )}
        </div>
      )}

      {sel && !importando && !construtor && (
        <div className="gaveta">
          <button className="fechar" onClick={fecharDetalhe}>✕</button>
          <h2>{sel.nome || sel.email}</h2>
          <div className="sub">{sel.email} · {sel.whatsapp || "sem WhatsApp"}</div>
          {podeOperar && (
            <button className="botao-manychat" style={{ marginBottom: 16 }} onClick={() => {
              setManyChatLead(sel);
              fecharDetalhe();
            }}>
              Abrir no ManyChat
            </button>
          )}
          {det?.suprimido && <div className="aviso">E-mail na lista de supressão — nunca receberá disparos.</div>}
          {!det && <div className="sub">carregando…</div>}
          {det && (
            <>
              <div className="caixa">
                <h2>Anotações</h2>
                <div className="sub">O que o time precisa lembrar sobre esta pessoa.</div>
                {podePreparar && (
                  <div className="linha" style={{ marginTop: 8 }}>
                    <input placeholder="escreva uma anotação…" value={novaNota}
                      onChange={(e) => setNovaNota(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") salvarNota(); }} />
                    <button style={{ flex: "0 0 auto" }} disabled={!novaNota.trim()}
                      onClick={salvarNota}>Anotar</button>
                  </div>
                )}
                {notas.map((n) => (
                  <div key={n.nota_id} style={{
                    padding: "8px 0", borderBottom: "1px dashed var(--borda)",
                    fontSize: "calc(13.5px * var(--escala-texto))",
                  }}>
                    {n.texto}
                    <div style={{ color: "var(--texto2)", fontSize: "calc(12px * var(--escala-texto))", marginTop: 2 }}>
                      {n.autor_email ?? "alguém do time"} · {new Date(n.created_at).toLocaleString("pt-BR")}
                      {" "}<button style={{ padding: "0 6px" }} onClick={() => apagarNota(n.nota_id)}>apagar</button>
                    </div>
                  </div>
                ))}
                {!notas.length && <span className="sub">nenhuma anotação ainda</span>}
              </div>

              <div className="caixa">
                <h2>Linha do tempo</h2>
                <div className="sub">
                  Tudo o que já aconteceu com esta pessoa, em ordem: listas, tags, eventos,
                  e-mails recebidos, aberturas, cliques, automações e compras.
                </div>
                <div style={{ marginTop: 10 }}>
                  {tempo.map((ev, i) => (
                    <div key={i} style={{
                      display: "flex", gap: 10, padding: "7px 0",
                      borderBottom: "1px dashed var(--borda)",
                      fontSize: "calc(13.5px * var(--escala-texto))",
                    }}>
                      <span style={{ fontSize: "calc(15px * var(--escala-texto))", lineHeight: 1.3 }}>
                        {ICONE_TEMPO[ev.tipo] ?? "•"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{ev.titulo}</b>
                        {ev.detalhe && <> — <span style={{ wordBreak: "break-word" }}>{ev.detalhe}</span></>}
                        <div style={{ color: "var(--texto2)", fontSize: "calc(12px * var(--escala-texto))" }}>
                          {new Date(ev.quando).toLocaleString("pt-BR")}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!tempo.length && <span className="sub">nada registrado ainda</span>}
                </div>
              </div>

              <div className="caixa">
                <h2>Histórico de e-mails</h2>
                {det.envios.map((e) => (
                  <div key={e.envio_id} style={{ padding: "5px 0", fontSize: "calc(13px * var(--escala-texto))", borderBottom: "1px dashed var(--borda)" }}>
                    <span className={`etiqueta ${STATUS_ENVIO[e.status] ?? "et-cinza"}`}>{e.status}</span>{" "}
                    {e.mensagens?.subject ?? e.mensagens?.nome ?? "?"}
                    <span style={{ color: "var(--texto2)" }}>
                      {" "}· {new Date(e.sent_at ?? e.queued_at).toLocaleString("pt-BR")}
                      {e.provider ? ` · ${e.provider}` : ""}
                    </span>
                  </div>
                ))}
                {!det.envios.length && <span className="sub">nenhum e-mail ainda</span>}
              </div>
              <div className="caixa">
                <h2>Listas</h2>
                {det.listas.map((li, i) => {
                  const [rot, cls] = STATUS_LISTA[li.status] ?? ["?", "et-cinza"];
                  return <div key={i} style={{ padding: "4px 0" }}>{li.nome} <span className={`etiqueta ${cls}`}>{rot}</span></div>;
                })}
                {!det.listas.length && <span className="sub">nenhuma</span>}
              </div>
              <div className="caixa">
                <h2>Tags</h2>
                {det.tags.map((t) => <span key={t} className="etiqueta et-roxa">{t}</span>)}
                {!det.tags.length && <span className="sub">nenhuma</span>}
              </div>
              <div className="caixa">
                <h2>Participações (eventos)</h2>
                {det.participacoes.map((p, i) => (
                  <div key={i} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                    {p.evento_origem}
                    <span style={{ color: "var(--texto2)" }}> · {new Date(p.created_at).toLocaleDateString("pt-BR")}</span>
                  </div>
                ))}
                {!det.participacoes.length && <span className="sub">nenhuma</span>}
              </div>
              {Object.keys(det.atributos).length > 0 && (
                <div className="caixa">
                  <h2>Campos personalizados</h2>
                  {Object.entries(det.atributos).map(([k, v]) => (
                    <div key={k} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}><b>{k}:</b> {String(v)}</div>
                  ))}
                </div>
              )}
              {ehAdmin && (
                <div className="caixa zona-perigo-lead">
                  <h2>Excluir lead da Ressoa</h2>
                  {!confirmandoExclusao ? (
                    <>
                      <div className="sub">
                        Disponível apenas para administradores. A exclusão não remove a pessoa do ManyChat.
                      </div>
                      <button className="perigo" onClick={() => {
                        setConfirmandoExclusao(true);
                        setTextoExclusao("");
                        setErroExclusao("");
                      }}>
                        Excluir este lead
                      </button>
                    </>
                  ) : (
                    <div className="confirmacao-exclusao-lead">
                      <div className="aviso">
                        Esta ação apaga o cadastro e os vínculos internos da Ressoa: listas, tags,
                        notas, compras, automações e histórico. O bloqueio de e-mail é preservado
                        para impedir novos envios. A pessoa no ManyChat não será apagada.
                      </div>
                      <label htmlFor="confirmar-exclusao-lead">
                        Digite <b>EXCLUIR</b> para confirmar
                      </label>
                      <input id="confirmar-exclusao-lead" autoComplete="off"
                        value={textoExclusao}
                        onChange={(e) => setTextoExclusao(e.target.value.toUpperCase())}
                        disabled={excluindoLead} />
                      {erroExclusao && <div className="aviso" role="alert">{erroExclusao}</div>}
                      <div className="acoes-exclusao-lead">
                        <button onClick={() => {
                          setConfirmandoExclusao(false);
                          setTextoExclusao("");
                          setErroExclusao("");
                        }} disabled={excluindoLead}>
                          Cancelar
                        </button>
                        <button className="perigo-solido"
                          disabled={textoExclusao !== "EXCLUIR" || excluindoLead}
                          onClick={excluirLeadSelecionado}>
                          {excluindoLead ? "Excluindo…" : "Excluir definitivamente"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ManyChatLeadDrawer lead={manyChatLead} ehAdmin={ehAdmin}
        onClose={() => setManyChatLead(null)} />
    </div>
  );
}
