import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import { useNavigate } from "react-router-dom";

type Tag = { tag_id: number; nome: string; descricao: string | null };

export default function Tags() {
  const [mesclando, setMesclando] = useState<null | { origens: number[]; destino: string }>(null);
  const { podePreparar } = useSessao();
  const navegar = useNavigate();
  const irParaLeads = (id: number) => navegar(`/leads?tag=${id}`);
  const [tags, setTags] = useState<Tag[]>([]);
  const [cont, setCont] = useState<Record<number, number>>({});
  const [usoAuto, setUsoAuto] = useState<Record<number, string[]>>({});
  const [nova, setNova] = useState({ nome: "", descricao: "" });
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Tag | null>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(0);

  async function carregar() {
    const [t, lt, autos] = await Promise.all([
      supabase.from("tags").select("tag_id, nome, descricao").order("nome"),
      supabase.rpc("contagem_tags"),
      supabase.from("automacoes").select("nome, gatilho, ativa"),
    ]);
    setTags(t.data ?? []);

    const mapa: Record<number, number> = {};
    for (const a of (lt.data ?? []) as any[]) mapa[a.tag_id] = Number(a.total);
    setCont(mapa);

    const uso: Record<number, string[]> = {};
    for (const a of (autos.data ?? []) as { nome: string; gatilho: any; ativa: boolean }[]) {
      if (a.gatilho?.tipo === "tag_adicionada" && a.gatilho?.tag_id) {
        (uso[a.gatilho.tag_id] ??= []).push(a.nome + (a.ativa ? "" : " (inativa)"));
      }
    }
    setUsoAuto(uso);
  }
  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!nova.nome.trim()) { alert("Dê um nome à tag."); return; }
    setOcupado(true);
    const { error } = await supabase.from("tags")
      .insert({ nome: nova.nome.trim(), descricao: nova.descricao.trim() || null });
    setOcupado(false);
    if (error) { alert(error.message); return; }
    setNova({ nome: "", descricao: "" }); setCriando(false); carregar();
  }

  async function salvarEdicao() {
    if (!editando) return;
    setOcupado(true);
    const { error } = await supabase.from("tags")
      .update({ nome: editando.nome.trim(), descricao: editando.descricao?.trim() || null })
      .eq("tag_id", editando.tag_id);
    setOcupado(false);
    if (error) { alert(error.message); return; }
    setEditando(null); carregar();
  }

  async function excluir(t: Tag) {
    const n = cont[t.tag_id] ?? 0;
    const autos = usoAuto[t.tag_id] ?? [];
    if (autos.length && !confirm(`A tag "${t.nome}" é gatilho da(s) automação(ões): ${autos.join(", ")}. Excluir mesmo assim vai quebrar esse gatilho. Continuar?`)) return;
    if (!confirm(`Excluir a tag "${t.nome}"?${n ? ` Ela será removida de ${n} lead(s).` : ""} Os leads continuam na base.`)) return;
    const { error } = await supabase.from("tags").delete().eq("tag_id", t.tag_id);
    if (error) { alert(error.message); return; }
    carregar();
  }

  const todas = tags.filter((t) =>
    !busca.trim() || t.nome.toLowerCase().includes(busca.toLowerCase()));
  const paginas = Math.max(1, Math.ceil(todas.length / porPagina));
  const filtradas = todas.slice(pagina * porPagina, (pagina + 1) * porPagina);

  // Mesclar reaponta as automações antes de apagar a tag. Sem isso, uma
  // automação continua viva apontando para uma tag que não existe mais:
  // ela para de disparar e ninguém percebe.
  async function confirmarMesclagem() {
    if (!mesclando) return;
    const destino = Number(mesclando.destino);
    if (!destino || !mesclando.origens.length) { alert("Escolha as tags e o destino."); return; }
    const nomes = mesclando.origens.map((id) => tags.find((t) => t.tag_id === id)?.nome).join(", ");
    const nomeDestino = tags.find((t) => t.tag_id === destino)?.nome;
    if (!confirm(
      `Unir ${mesclando.origens.length} tag(s) em "${nomeDestino}"?\n\n` +
      `Some(m): ${nomes}\n\n` +
      "Os contatos passam para a tag de destino e as automações que usavam as " +
      "antigas passam a usar a nova. As tags antigas são apagadas.")) return;

    const { data, error } = await supabase.rpc("mesclar_tags", {
      p_origens: mesclando.origens, p_destino: destino,
    });
    if (error) { alert(error.message); return; }
    const r = data as Record<string, number | string>;
    if (r.erro) { alert(String(r.erro)); return; }
    alert(
      `Feito.\n\n${r.contatos_movidos} contatos passaram para "${nomeDestino}".\n` +
      `${r.automacoes_reapontadas} automação(ões) e ${r.passos_reapontados} passo(s) reapontados.\n` +
      `${r.tags_removidas} tag(s) removida(s).`);
    setMesclando(null);
    carregar();
  }

  return (
    <div>
      <h1>Tags <span className="contagem">({tags.length})</span></h1>
      <div className="sub">Marcadores que você aplica nos leads — servem para segmentar e para disparar automações.</div>

      <div className="caixa">
        <div className="linha">
          <input placeholder="Buscar tag…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {podePreparar && (
            <>
              <button style={{ flex: "0 0 auto" }}
                onClick={() => setMesclando({ origens: [], destino: "" })}>
                ⤳ Mesclar tags
              </button>
              <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => setCriando(!criando)}>
                + Nova tag
              </button>
            </>
          )}
        </div>
        {criando && (
          <div style={{ marginTop: 12 }}>
            <label>Nome da tag</label>
            <input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })}
              placeholder="CASA_H_2026_08_10" />
            <label>Descrição (opcional)</label>
            <div className="linha">
              <input value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })}
                placeholder="Turma do desafio de 10/08" />
              <button className="primario" style={{ flex: "0 0 auto" }} disabled={ocupado} onClick={criar}>Criar</button>
              <button style={{ flex: "0 0 auto" }} onClick={() => setCriando(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div className="caixa">
        <table>
          <thead><tr><th>Tag</th><th>Leads</th><th>Usada em automação</th><th></th></tr></thead>
          <tbody>
            {filtradas.map((t) => (
              <tr key={t.tag_id}>
                <td>
                  <button className="num-link" onClick={() => irParaLeads(t.tag_id)}>
                    <span className="etiqueta et-roxa">{t.nome}</span>
                  </button>
                  {t.descricao && <div style={{ color: "var(--ac-texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>{t.descricao}</div>}
                </td>
                <td><button className="num-link" onClick={() => irParaLeads(t.tag_id)}>{(cont[t.tag_id] ?? 0).toLocaleString("pt-BR")}</button></td>
                <td style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--ac-texto2)" }}>
                  {(usoAuto[t.tag_id] ?? []).join(", ") || "—"}
                </td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  {podePreparar && <>
                    <button onClick={() => setEditando(t)}>Editar</button>{" "}
                    <button className="perigo" onClick={() => excluir(t)}>Excluir</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="paginacao">
          <span>Linhas:</span>
          <select style={{ width: 90 }} value={porPagina}
            onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0); }}>
            {[10, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>{todas.length.toLocaleString("pt-BR")} tags</span>
          <button disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹</button>
          <span>página {pagina + 1} de {paginas}</span>
          <button disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>›</button>
        </div>
      </div>

      {editando && (
        <div className="gaveta">
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>
          <h2>Editar tag</h2>
          <label>Nome</label>
          <input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
          <label>Descrição</label>
          <input value={editando.descricao ?? ""} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} />
          <div className="linha" style={{ marginTop: 16 }}>
            <button className="primario" disabled={ocupado} onClick={salvarEdicao}>Salvar</button>
            <button onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {mesclando && (
        <div className="gaveta" style={{ width: 470 }}>
          <button className="fechar" onClick={() => setMesclando(null)}>✕</button>
          <h2>Mesclar tags</h2>
          <div className="sub">
            Junta várias tags numa só. Serve para limpar duplicatas como
            CADASTRADOS e CADASTRADO, que dividem a mesma audiência em duas.
          </div>

          <label>Tags que vão sumir</label>
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--borda)",
                        borderRadius: 8, padding: 8 }}>
            {tags.map((t) => (
              <label key={t.tag_id} style={{ padding: "5px 2px", cursor: "pointer" }}>
                <input type="checkbox"
                  checked={mesclando.origens.includes(t.tag_id)}
                  disabled={String(t.tag_id) === mesclando.destino}
                  onChange={(e) => setMesclando({
                    ...mesclando,
                    origens: e.target.checked
                      ? [...mesclando.origens, t.tag_id]
                      : mesclando.origens.filter((x) => x !== t.tag_id),
                  })} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden",
                               textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.nome}</span>
                <span style={{ color: "var(--texto2)", fontSize: "calc(12px * var(--escala-texto))" }}>
                  {(cont[t.tag_id] ?? 0).toLocaleString("pt-BR")}
                </span>
              </label>
            ))}
          </div>

          <label>Tag que fica</label>
          <select value={mesclando.destino}
            onChange={(e) => setMesclando({
              ...mesclando, destino: e.target.value,
              origens: mesclando.origens.filter((x) => String(x) !== e.target.value),
            })}>
            <option value="">— escolher —</option>
            {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
          </select>

          <div className="linha" style={{ marginTop: 18 }}>
            <button className="primario" onClick={confirmarMesclagem}>Mesclar</button>
            <button onClick={() => setMesclando(null)}>Cancelar</button>
          </div>
        </div>
      )}

    </div>
  );
}
