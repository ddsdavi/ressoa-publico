import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import { useNavigate } from "react-router-dom";

type Lista = { lista_id: number; nome: string; descricao: string | null };
type Contagem = { ativos: number; descadastrados: number; bounces: number; total: number };

export default function Listas() {
  const { podePreparar } = useSessao();
  const navegar = useNavigate();
  const irParaLeads = (id: number, status?: number) =>
    navegar(`/leads?lista=${id}${status !== undefined ? `&status=${status}` : ""}`);
  const [listas, setListas] = useState<Lista[]>([]);
  const [cont, setCont] = useState<Record<number, Contagem>>({});
  const [nova, setNova] = useState({ nome: "", descricao: "" });
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Lista | null>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(0);

  async function carregar() {
    const { data } = await supabase.from("listas")
      .select("lista_id, nome, descricao").order("nome");
    setListas(data ?? []);

    // a contagem é feita NO BANCO (somar no navegador quebra: a API corta em 1.000 linhas)
    const { data: agregados } = await supabase.rpc("contagem_listas");
    const mapa: Record<number, Contagem> = {};
    for (const a of (agregados ?? []) as any[]) {
      mapa[a.lista_id] = {
        ativos: Number(a.ativos), descadastrados: Number(a.descadastrados),
        bounces: Number(a.bounces), total: Number(a.total),
      };
    }
    setCont(mapa);
  }
  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!nova.nome.trim()) { alert("Dê um nome à lista."); return; }
    setOcupado(true);
    const { error } = await supabase.from("listas")
      .insert({ nome: nova.nome.trim(), descricao: nova.descricao.trim() || null });
    setOcupado(false);
    if (error) { alert(error.message); return; }
    setNova({ nome: "", descricao: "" }); setCriando(false); carregar();
  }

  async function salvarEdicao() {
    if (!editando) return;
    setOcupado(true);
    const { error } = await supabase.from("listas")
      .update({ nome: editando.nome.trim(), descricao: editando.descricao?.trim() || null })
      .eq("lista_id", editando.lista_id);
    setOcupado(false);
    if (error) { alert(error.message); return; }
    setEditando(null); carregar();
  }

  async function excluir(l: Lista) {
    const c = cont[l.lista_id];
    if (!confirm(`Excluir a lista "${l.nome}"?${c?.total ? ` ${c.total} vínculo(s) de lead serão desfeitos.` : ""} Os leads em si continuam na base.`)) return;
    const { error } = await supabase.from("listas").delete().eq("lista_id", l.lista_id);
    if (error) { alert(error.message); return; }
    carregar();
  }

  const todas = listas.filter((l) =>
    !busca.trim() || l.nome.toLowerCase().includes(busca.toLowerCase()));
  const paginas = Math.max(1, Math.ceil(todas.length / porPagina));
  const filtradas = todas.slice(pagina * porPagina, (pagina + 1) * porPagina);

  async function duplicar(l: { lista_id: number; nome: string }) {
    const nome = prompt("Nome da nova lista:", l.nome + " (cópia)");
    if (nome === null) return;
    const comContatos = confirm(
      "Copiar também os contatos ativos?\n\n" +
      "OK = copia a lista com os contatos.\n" +
      "Cancelar = cria a lista vazia (o caso comum: repetir a estrutura para o próximo lançamento).");
    const { error } = await supabase.rpc("duplicar_lista", {
      p_lista: l.lista_id, p_nome: nome.trim(), p_com_contatos: comContatos,
    });
    if (error) { alert(error.message); return; }
    carregar();
  }

  return (
    <div>
      <h1>Listas <span className="contagem">({listas.length})</span></h1>
      <div className="sub">Cada lista é um evento ou público — é o destino das campanhas e o gatilho das automações.</div>

      <div className="caixa">
        <div className="linha">
          <input placeholder="Buscar lista…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {podePreparar && (
            <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => setCriando(!criando)}>
              + Nova lista
            </button>
          )}
        </div>
        {criando && (
          <div style={{ marginTop: 12 }}>
            <label>Nome da lista</label>
            <input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })}
              placeholder="LISTA_EXEMPLO" />
            <label>Descrição (opcional)</label>
            <div className="linha">
              <input value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })}
                placeholder="Compradores da imersão semanal" />
              <button className="primario" style={{ flex: "0 0 auto" }} disabled={ocupado} onClick={criar}>Criar</button>
              <button style={{ flex: "0 0 auto" }} onClick={() => setCriando(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div className="caixa">
        <table>
          <thead><tr>
            <th>Lista</th><th>Ativos</th><th>Descadastrados</th><th>Bounces</th><th>Total</th><th></th>
          </tr></thead>
          <tbody>
            {filtradas.map((l) => {
              const c = cont[l.lista_id] ?? { ativos: 0, descadastrados: 0, bounces: 0, total: 0 };
              return (
                <tr key={l.lista_id}>
                  <td>
                    <button className="link-tabela" onClick={() => irParaLeads(l.lista_id)}>{l.nome}</button>
                    {l.descricao && <div style={{ color: "var(--ac-texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>{l.descricao}</div>}
                  </td>
                  <td>
                    <button className="num-link" onClick={() => irParaLeads(l.lista_id, 1)} title="Ver os ativos desta lista">
                      <span className="etiqueta et-verde">{c.ativos.toLocaleString("pt-BR")}</span>
                    </button>
                  </td>
                  <td>{c.descadastrados
                    ? <button className="num-link" onClick={() => irParaLeads(l.lista_id, 2)} title="Ver os descadastrados"><span className="etiqueta et-amarela">{c.descadastrados}</span></button>
                    : "—"}</td>
                  <td>{c.bounces
                    ? <button className="num-link" onClick={() => irParaLeads(l.lista_id, 3)} title="Ver os bounces"><span className="etiqueta et-vermelha">{c.bounces}</span></button>
                    : "—"}</td>
                  <td><button className="num-link" onClick={() => irParaLeads(l.lista_id)}>{c.total.toLocaleString("pt-BR")}</button></td>
                  <td className="direita" style={{ whiteSpace: "nowrap" }}>
                    {podePreparar && <>
                      <button onClick={() => setEditando(l)}>Editar</button>{" "}
                      <button onClick={() => duplicar(l)}>Duplicar</button>{" "}
                      <button className="perigo" onClick={() => excluir(l)}>Excluir</button>
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="paginacao">
          <span>Linhas:</span>
          <select style={{ width: 90 }} value={porPagina}
            onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0); }}>
            {[10, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>{todas.length.toLocaleString("pt-BR")} listas</span>
          <button disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹</button>
          <span>página {pagina + 1} de {paginas}</span>
          <button disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>›</button>
        </div>
      </div>

      {editando && (
        <div className="gaveta">
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>
          <h2>Editar lista</h2>
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
    </div>
  );
}
