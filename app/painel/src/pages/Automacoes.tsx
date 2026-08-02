import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import FluxoAutomacao from "../components/FluxoAutomacao";

type Passo = { passo_id?: string; ordem: number; tipo: string; config: Record<string, any> };
type Auto = {
  automacao_id: string; nome: string; ativa: boolean; origem_ac_id: number | null;
  gatilho: Record<string, any> | null; nota: string | null;
  automacao_passos: Passo[];
};

export default function Automacoes() {
  const [autos, setAutos] = useState<Auto[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [tags, setTags] = useState<{ tag_id: number; nome: string }[]>([]);
  const [mensagens, setMensagens] = useState<{ mensagem_id: string; nome: string; subject: string }[]>([]);
  const [execs, setExecs] = useState<Record<string, number>>({});
  const [editId, setEditId] = useState<string | "nova" | null>(null);
  const [eNome, setENome] = useState("");
  const [eGatilhoTipo, setEGatilhoTipo] = useState("lista_inscrita");
  const [eGatilhoAlvo, setEGatilhoAlvo] = useState("");
  const [ePassos, setEPassos] = useState<Passo[]>([]);
  const [eAtiva, setEAtiva] = useState(false);

  const mapListas = Object.fromEntries(listas.map((x) => [x.lista_id, x.nome]));
  const mapTags = Object.fromEntries(tags.map((x) => [x.tag_id, x.nome]));

  async function carregar() {
    const [a, l, t, m, e] = await Promise.all([
      supabase.from("automacoes").select("*, automacao_passos(*)").order("nome"),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("tags").select("tag_id, nome").order("nome"),
      supabase.from("mensagens").select("mensagem_id, nome, subject").order("created_at", { ascending: false }),
      supabase.from("automacao_execucoes").select("automacao_fk"),
    ]);
    setAutos((a.data as Auto[]) ?? []);
    setListas(l.data ?? []);
    setTags((t.data ?? []) as never);
    setMensagens(m.data ?? []);
    const contagem: Record<string, number> = {};
    for (const row of e.data ?? []) contagem[row.automacao_fk] = (contagem[row.automacao_fk] ?? 0) + 1;
    setExecs(contagem);
  }
  useEffect(() => { carregar(); }, []);

  function descreverGatilho(g: Auto["gatilho"]): string {
    if (!g) return "sem gatilho definido";
    if (g.tipo === "lista_inscrita") {
      if (g.qualquer_lista) return "Entrou em QUALQUER lista";
      return `Entrou na lista "${mapListas[g.lista_id] ?? g.lista_id}"`;
    }
    if (g.tipo === "tag_adicionada") return `Ganhou a tag "${mapTags[g.tag_id] ?? g.tag_id}"`;
    if (g.tipo === "lead_criado") return "Lead novo criado";
    return String(g.tipo);
  }

  function descreverPasso(p: Passo): string {
    const c = p.config ?? {};
    switch (p.tipo) {
      case "enviar_email": {
        const m = mensagens.find((x) => x.mensagem_id === c.mensagem_id);
        return `Enviar e-mail: ${m ? m.nome : (c.mensagem ?? "?")}`;
      }
      case "webhook": return `Webhook → ${c.url}`;
      case "google_sheets": return `Google Sheets (${c.nota ?? "add row"})`;
      case "esperar": return `Esperar ${c.duracao ?? "?"}`;
      case "aplicar_tag": return `Aplicar tag "${mapTags[Number(c.tag_id)] ?? c.tag_id}"`;
      case "remover_tag": return `Remover tag "${mapTags[Number(c.tag_id)] ?? c.tag_id}"`;
      case "inscrever_lista": return `Inscrever na lista "${mapListas[Number(c.lista_id)] ?? c.lista_id}"`;
      case "desinscrever_lista": return `Desinscrever da lista "${mapListas[Number(c.lista_id)] ?? c.lista_id}"`;
      default: return p.tipo;
    }
  }

  async function alternar(a: Auto) {
    const acao = a.ativa ? "DESATIVAR" : "ATIVAR";
    if (!confirm(`${acao} a automação "${a.nome}"?`)) return;
    await supabase.from("automacoes").update({ ativa: !a.ativa }).eq("automacao_id", a.automacao_id);
    carregar();
  }

  function abrirEditor(a: Auto | null) {
    if (a) {
      setEditId(a.automacao_id);
      setENome(a.nome);
      setEAtiva(a.ativa);
      setEGatilhoTipo(a.gatilho?.tipo ?? "lista_inscrita");
      setEGatilhoAlvo(String(a.gatilho?.lista_id ?? a.gatilho?.tag_id ?? ""));
      setEPassos([...(a.automacao_passos ?? [])].sort((x, y) => x.ordem - y.ordem)
        .map((p) => ({ ordem: p.ordem, tipo: p.tipo, config: { ...(p.config ?? {}) } })));
    } else {
      setEditId("nova");
      setENome("");
      setEAtiva(false);
      setEGatilhoTipo("lista_inscrita");
      setEGatilhoAlvo("");
      setEPassos([]);
    }
  }


  async function salvarEditor() {
    if (!eNome.trim()) { alert("Dê um nome à automação."); return; }
    if ((eGatilhoTipo === "lista_inscrita" || eGatilhoTipo === "tag_adicionada") && !eGatilhoAlvo) {
      alert("Escolha a lista/tag do gatilho.");
      return;
    }
    for (const p of ePassos) {
      if (p.tipo === "enviar_email" && !p.config.mensagem_id && !p.config.mensagem) { alert("Há um passo de e-mail sem mensagem escolhida."); return; }
      if (p.tipo === "webhook" && !p.config.url) { alert("Há um passo de webhook sem URL."); return; }
      if (p.tipo === "esperar" && !p.config.duracao) { alert("Há um passo de espera sem duração."); return; }
      if ((p.tipo === "aplicar_tag" || p.tipo === "remover_tag") && !p.config.tag_id) { alert("Há um passo de tag sem tag escolhida."); return; }
      if ((p.tipo === "inscrever_lista" || p.tipo === "desinscrever_lista") && !p.config.lista_id) { alert("Há um passo de lista sem lista escolhida."); return; }
    }
        const gatilho: Record<string, unknown> = { tipo: eGatilhoTipo };
    if (eGatilhoTipo === "lista_inscrita") gatilho.lista_id = Number(eGatilhoAlvo);
    if (eGatilhoTipo === "tag_adicionada") gatilho.tag_id = Number(eGatilhoAlvo);

    let id = editId;
    if (editId === "nova") {
      const { data, error } = await supabase.from("automacoes")
        .insert({ nome: eNome.trim(), gatilho, ativa: eAtiva })
        .select("automacao_id").single();
      if (error) { alert(error.message); return; }
      id = data.automacao_id;
    } else {
      const { error } = await supabase.from("automacoes")
        .update({ nome: eNome.trim(), gatilho, ativa: eAtiva }).eq("automacao_id", editId);
      if (error) { alert(error.message); return; }
      await supabase.from("automacao_passos").delete().eq("automacao_fk", editId);
    }
    if (ePassos.length) {
      const { error } = await supabase.from("automacao_passos").insert(
        ePassos.map((p, i) => ({ automacao_fk: id, ordem: i + 1, tipo: p.tipo, config: p.config })));
      if (error) alert("Passos: " + error.message);
    }
    setEditId(null);
    carregar();
  }

  async function adicionarContatos(alvo: { emails?: string; lista?: number; tag?: number }) {
    if (editId === "nova" || !editId) { alert("Salve a automação antes de adicionar contatos."); return; }
    let ids: string[] = [];

    if (alvo.emails) {
      const lista = alvo.emails.split(/[\n,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!lista.length) { alert("Nenhum e-mail informado."); return; }
      const { data } = await supabase.from("tabela_1_leads").select("lead_id, email").in("email", lista);
      ids = ((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id);
      const achados = ((data ?? []) as { email: string }[]).map((r) => r.email.toLowerCase());
      const faltando = lista.filter((e) => !achados.includes(e));
      if (faltando.length && !confirm(
        `${faltando.length} e-mail(s) não estão na base e serão ignorados:\n\n` +
        faltando.slice(0, 8).join("\n") + "\n\nContinuar com os outros?")) return;
    } else if (alvo.lista) {
      // só quem está ativo: quem se descadastrou não volta por aqui
      const { data } = await supabase.from("lead_listas")
        .select("lead_fk").eq("lista_fk", alvo.lista).eq("status", 1).limit(5000);
      ids = ((data ?? []) as { lead_fk: string }[]).map((r) => r.lead_fk);
    } else if (alvo.tag) {
      const { data } = await supabase.from("lead_tags")
        .select("lead_fk").eq("tag_fk", alvo.tag).limit(5000);
      ids = ((data ?? []) as { lead_fk: string }[]).map((r) => r.lead_fk);
    }

    if (!ids.length) { alert("Nenhum contato encontrado."); return; }
    if (!confirm(`Colocar ${ids.length} contato(s) nesta automação agora?`)) return;

    const { data, error } = await supabase.rpc("adicionar_a_automacao", {
      p_automacao: editId, p_leads: ids,
    });
    if (error) { alert(error.message); return; }
    const r = data as Record<string, number | string>;
    if (r.erro) { alert(String(r.erro)); return; }
    alert(`${r.adicionados} contato(s) entraram na automação.` +
      (Number(r.ja_estavam) > 0 ? `\n${r.ja_estavam} já estavam dentro e foram ignorados.` : ""));
    carregar();
  }

  return (
    <div>
      <h1>Automações</h1>
      <div className="sub">Gatilho → passos, executados pelo motor no Postgres (ciclo de 1 min). Novas automações nascem desativadas.</div>

      <div className="caixa">
        <button className="primario" onClick={() => abrirEditor(null)}>+ Nova automação</button>
      </div>

      {autos.map((a) => (
        <div className="caixa" key={a.automacao_id}>
          <div className="linha">
            <div style={{ flex: 3 }}>
              <h2 style={{ marginBottom: 2 }}>
                {a.nome}{" "}
                {a.ativa
                  ? <span className="etiqueta et-verde">ativa</span>
                  : <span className="etiqueta et-cinza">inativa</span>}
                {a.origem_ac_id && <span className="etiqueta et-cinza">AC #{a.origem_ac_id}</span>}
                {execs[a.automacao_id] ? <span className="etiqueta et-roxa">{execs[a.automacao_id]} execuções</span> : null}
              </h2>
              <div style={{ fontSize: "calc(13px * var(--escala-texto))", color: "var(--texto2)" }}>
                Gatilho: <b style={{ color: "var(--texto)" }}>{descreverGatilho(a.gatilho)}</b>
                {a.nota && <> · <i>{a.nota}</i></>}
              </div>
            </div>
            <div className="direita" style={{ flex: 1, whiteSpace: "nowrap" }}>
              <button onClick={() => abrirEditor(a)}>Editar</button>{" "}
              <button onClick={() => alternar(a)}>{a.ativa ? "Desativar" : "Ativar"}</button>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {[...a.automacao_passos].sort((x, y) => x.ordem - y.ordem).map((p) => (
              <div className="passo" key={p.passo_id}>
                <span className="ordem">{p.ordem}</span>
                <span>{descreverPasso(p)}</span>
              </div>
            ))}
            {!a.automacao_passos.length && <div className="sub">sem passos</div>}
          </div>
        </div>
      ))}

      {editId && (
        <FluxoAutomacao
          nome={eNome}
          gatilho={eGatilhoTipo
            ? {
              tipo: eGatilhoTipo,
              ...(eGatilhoTipo === "lista_inscrita" && eGatilhoAlvo ? { lista_id: Number(eGatilhoAlvo) } : {}),
              ...(eGatilhoTipo === "tag_adicionada" && eGatilhoAlvo ? { tag_id: Number(eGatilhoAlvo) } : {}),
            }
            : null}
          passos={ePassos}
          ativa={eAtiva}
          execucoes={editId !== "nova" ? (execs[editId] ?? 0) : 0}
          novo={editId === "nova"}
          ref={{ listas, tags, mensagens }}
          onMudar={(p) => {
            if (p.nome !== undefined) setENome(p.nome);
            if (p.ativa !== undefined) setEAtiva(p.ativa);
            if (p.passos !== undefined) setEPassos(p.passos);
            if (p.gatilho !== undefined) {
              setEGatilhoTipo(p.gatilho?.tipo ?? "lista_inscrita");
              setEGatilhoAlvo(String(p.gatilho?.lista_id ?? p.gatilho?.tag_id ?? ""));
            }
          }}
          onSalvar={salvarEditor}
          onFechar={() => setEditId(null)}
          onVerContatos={() => alert("Em breve: a lista de quem passou por esta automação.")}
          onAdicionarContatos={adicionarContatos}
        />
      )}

    </div>
  );
}
