import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";

type Stats = {
  campanha_id: string; nome: string; status: string;
  enviados: number; suprimidos: number; aberturas_unicas: number;
  cliques_unicos: number; hard_bounces: number; descadastros: number;
};
type Mensagem = { mensagem_id: string; nome: string; subject: string };
type Lista = { lista_id: number; nome: string };
type Segmento = { segmento_id: string; nome: string; definicao: Record<string, unknown> };

type Relatorio = {
  abriram: { email: string; quando: string }[];
  cliques: { url: string; total: number; unicos: number }[];
  bounces: string[];
  descadastros: string[];
};

const STATUS: Record<string, string> = {
  draft: "et-cinza", scheduled: "et-amarela", sending: "et-roxa",
  sent: "et-verde", paused: "et-amarela", cancelled: "et-vermelha",
};

export default function Campanhas() {
  const { podeOperar } = useSessao();
  const [stats, setStats] = useState<Stats[]>([]);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [listas, setListas] = useState<Lista[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [msgId, setMsgId] = useState("");
  const [tipoAud, setTipoAud] = useState<"listas" | "segmento">("listas");
  const [listasSel, setListasSel] = useState<number[]>([]);
  const [segSel, setSegSel] = useState("");
  const [previaSeg, setPreviaSeg] = useState<number | null>(null);
  const [agendarEm, setAgendarEm] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [relDe, setRelDe] = useState<Stats | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);

  async function carregar() {
    const [s, m, l, g] = await Promise.all([
      supabase.from("campanha_stats").select("*").order("nome"),
      supabase.from("mensagens").select("mensagem_id, nome, subject").order("created_at", { ascending: false }),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("segmentos").select("*").order("nome"),
    ]);
    setStats((s.data as Stats[]) ?? []);
    setMensagens(m.data ?? []);
    setListas(l.data ?? []);
    setSegmentos((g.data as never) ?? []);
  }
  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    (async () => {
      setPreviaSeg(null);
      const s = segmentos.find((x) => x.segmento_id === segSel);
      if (!s) return;
      const { data } = await supabase.rpc("contar_segmento", { p_def: s.definicao });
      setPreviaSeg(data ?? null);
    })();
  }, [segSel]);

  async function criar(disparar: boolean) {
    if (!nome.trim() || !msgId) { alert("Preencha nome e mensagem."); return; }
    if (tipoAud === "listas" && !listasSel.length) { alert("Escolha ao menos uma lista."); return; }
    if (tipoAud === "segmento" && !segSel) { alert("Escolha um segmento."); return; }
    setOcupado(true);
    const { data, error } = await supabase.from("campanhas").insert({
      nome: nome.trim(),
      mensagem_fk: msgId,
      lista_ids: tipoAud === "listas" ? listasSel : null,
      segmento_fk: tipoAud === "segmento" ? segSel : null,
      status: agendarEm && !disparar ? "scheduled" : "draft",
      scheduled_at: agendarEm && !disparar ? new Date(agendarEm).toISOString() : null,
    }).select("campanha_id").single();
    if (error) { alert(error.message); setOcupado(false); return; }
    if (disparar) {
      const { data: qtd, error: e2 } = await supabase.rpc("disparar_campanha", { p_campanha: data.campanha_id });
      if (e2) alert(e2.message);
      else alert(`Campanha disparada: ${qtd} e-mails enfileirados (respeitando supressão e status).`);
    }
    setCriando(false); setNome(""); setMsgId(""); setListasSel([]); setSegSel(""); setAgendarEm("");
    setOcupado(false);
    carregar();
  }

  async function dispararExistente(id: string) {
    if (!confirm("Disparar esta campanha agora?")) return;
    const { data: qtd, error } = await supabase.rpc("disparar_campanha", { p_campanha: id });
    if (error) alert(error.message);
    else alert(`${qtd} e-mails enfileirados.`);
    carregar();
  }

  async function abrirRelatorio(c: Stats) {
    setRelDe(c);
    setRel(null);
    const { data } = await supabase.from("eventos_email")
      .select("tipo, url, occurred_at, envios!inner(campanha_fk, tabela_1_leads(email))")
      .eq("envios.campanha_fk", c.campanha_id)
      .order("occurred_at", { ascending: false })
      .limit(5000);
    const eventos = (data as any[]) ?? [];
    const abriramMap = new Map<string, string>();
    const cliquesMap = new Map<string, { total: number; emails: Set<string> }>();
    const bounces = new Set<string>();
    const desc = new Set<string>();
    for (const e of eventos) {
      const email = e.envios?.tabela_1_leads?.email ?? "?";
      if (e.tipo === "open" && !abriramMap.has(email)) abriramMap.set(email, e.occurred_at);
      if (e.tipo === "click" && e.url) {
        const atual = cliquesMap.get(e.url) ?? { total: 0, emails: new Set<string>() };
        atual.total++; atual.emails.add(email);
        cliquesMap.set(e.url, atual);
      }
      if (e.tipo === "bounce_hard" || e.tipo === "bounce_soft") bounces.add(email);
      if (e.tipo === "unsubscribe") desc.add(email);
    }
    setRel({
      abriram: [...abriramMap.entries()].map(([email, quando]) => ({ email, quando })),
      cliques: [...cliquesMap.entries()].map(([url, v]) => ({ url, total: v.total, unicos: v.emails.size }))
        .sort((a, b) => b.total - a.total),
      bounces: [...bounces],
      descadastros: [...desc],
    });
  }

  return (
    <div>
      <h1>Campanhas</h1>
      <div className="sub">Disparos pontuais para listas ou segmentos — o motor respeita supressão e status, sempre.</div>

      <div className="caixa">
        {!criando ? (
          <button className="primario" onClick={() => setCriando(true)}>+ Nova campanha</button>
        ) : (
          <div>
            <h2>Nova campanha</h2>
            <label>Nome interno</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="[CASA_H] [ULTIMO DIA]" />
            <label>Mensagem (e-mail)</label>
            <select value={msgId} onChange={(e) => setMsgId(e.target.value)}>
              <option value="">— escolher —</option>
              {mensagens.map((m) => <option key={m.mensagem_id} value={m.mensagem_id}>{m.nome} · {m.subject}</option>)}
            </select>
            <label>Audiência</label>
            <div className="linha" style={{ marginBottom: 8 }}>
              <button className={tipoAud === "listas" ? "primario" : ""} onClick={() => setTipoAud("listas")}>Por listas</button>
              <button className={tipoAud === "segmento" ? "primario" : ""} onClick={() => setTipoAud("segmento")}>Por segmento salvo</button>
            </div>
            {tipoAud === "listas" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {listas.map((l) => (
                  <button key={l.lista_id}
                    className={listasSel.includes(l.lista_id) ? "primario" : ""}
                    onClick={() => setListasSel(listasSel.includes(l.lista_id)
                      ? listasSel.filter((x) => x !== l.lista_id)
                      : [...listasSel, l.lista_id])}>
                    {l.nome}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <select value={segSel} onChange={(e) => setSegSel(e.target.value)}>
                  <option value="">— escolher segmento (salve em Leads → 💾) —</option>
                  {segmentos.map((s) => <option key={s.segmento_id} value={s.segmento_id}>{s.nome}</option>)}
                </select>
                {previaSeg !== null && (
                  <div className="sub" style={{ marginTop: 6 }}>≈ {previaSeg.toLocaleString("pt-BR")} leads neste segmento agora</div>
                )}
              </div>
            )}
            <label>Agendar para (opcional — vazio = disparo manual)</label>
            <input type="datetime-local" value={agendarEm} onChange={(e) => setAgendarEm(e.target.value)} />
            <div className="linha" style={{ marginTop: 16 }}>
              <button disabled={ocupado} onClick={() => criar(false)}>
                {agendarEm ? "Salvar e agendar" : "Salvar rascunho"}
              </button>
              {podeOperar
                ? <button className="primario" disabled={ocupado} onClick={() => criar(true)}>Disparar agora</button>
                : <span className="sub" style={{ flex: "0 0 auto", margin: 0 }}>Quem dispara é a Terapeuta ou a Admin.</span>}
              <button onClick={() => setCriando(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div className="caixa">
        <table>
          <thead><tr>
            <th>Campanha</th><th>Status</th><th>Enviados</th><th>Aberturas</th>
            <th>Cliques</th><th>Bounces</th><th>Descadastros</th><th></th>
          </tr></thead>
          <tbody>
            {stats.map((c) => (
              <tr key={c.campanha_id}>
                <td>{c.nome}</td>
                <td><span className={`etiqueta ${STATUS[c.status] ?? "et-cinza"}`}>{c.status}</span></td>
                <td>{c.enviados}{c.suprimidos > 0 && <span style={{ color: "var(--texto2)" }}> (+{c.suprimidos} supr.)</span>}</td>
                <td>{c.aberturas_unicas}</td>
                <td>{c.cliques_unicos}</td>
                <td>{c.hard_bounces}</td>
                <td>{c.descadastros}</td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => abrirRelatorio(c)}>Relatório</button>{" "}
                  {podeOperar && (c.status === "draft" || c.status === "scheduled") &&
                    <button onClick={() => dispararExistente(c.campanha_id)}>Disparar</button>}
                </td>
              </tr>
            ))}
            {!stats.length && <tr><td colSpan={8} style={{ color: "var(--texto2)" }}>Nenhuma campanha ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      {relDe && (
        <div className="gaveta" style={{ width: 620 }}>
          <button className="fechar" onClick={() => setRelDe(null)}>✕</button>
          <h2>Relatório · {relDe.nome}</h2>
          <div className="cartoes" style={{ marginTop: 12 }}>
            <div className="cartao"><div className="num">{relDe.enviados}</div><div className="rot">Enviados</div></div>
            <div className="cartao"><div className="num">{relDe.aberturas_unicas}</div><div className="rot">Aberturas únicas</div></div>
            <div className="cartao"><div className="num">{relDe.cliques_unicos}</div><div className="rot">Cliques únicos</div></div>
          </div>
          {!rel && <div className="sub">carregando eventos…</div>}
          {rel && (
            <>
              <div className="caixa">
                <h2>Cliques por link</h2>
                {rel.cliques.map((c) => (
                  <div key={c.url} style={{ padding: "4px 0", fontSize: "calc(12.5px * var(--escala-texto))", borderBottom: "1px dashed var(--borda)" }}>
                    <span className="etiqueta et-roxa">{c.unicos} únicos</span> {c.url}
                  </div>
                ))}
                {!rel.cliques.length && <span className="sub">nenhum clique registrado</span>}
              </div>
              <div className="caixa">
                <h2>Quem abriu ({rel.abriram.length})</h2>
                {rel.abriram.slice(0, 100).map((a) => (
                  <div key={a.email} style={{ padding: "3px 0", fontSize: "calc(13px * var(--escala-texto))" }}>
                    {a.email}
                    <span style={{ color: "var(--texto2)" }}> · {new Date(a.quando).toLocaleString("pt-BR")}</span>
                  </div>
                ))}
                {rel.abriram.length > 100 && <div className="sub">… e mais {rel.abriram.length - 100}</div>}
                {!rel.abriram.length && <span className="sub">nenhuma abertura registrada</span>}
              </div>
              {(rel.bounces.length > 0 || rel.descadastros.length > 0) && (
                <div className="caixa">
                  <h2>Problemas</h2>
                  {rel.bounces.map((e) => <div key={e} style={{ fontSize: "calc(13px * var(--escala-texto))" }}><span className="etiqueta et-vermelha">bounce</span> {e}</div>)}
                  {rel.descadastros.map((e) => <div key={e} style={{ fontSize: "calc(13px * var(--escala-texto))" }}><span className="etiqueta et-amarela">descadastro</span> {e}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
