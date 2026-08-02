import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";

// Campos próprios do contato.
//
// Os valores sempre existiram — vieram do ActiveCampaign e ficam num JSON
// por lead. O que faltava era o cadastro: nome legível, tipo e grupo. Sem
// ele a coluna aparece como "16LC-UTM-SOURCE" e ninguém sabe o que é.

type Campo = {
  campo_id: number; chave: string; rotulo: string; tipo: string;
  grupo: string; opcoes: string[] | null; ordem: number; perstag: string | null;
};
type EmUso = { chave: string; leads: number; cadastrado: boolean; exemplo: string | null };

const TIPOS: [string, string][] = [
  ["texto", "Linha de texto"],
  ["texto_longo", "Texto longo"],
  ["numero", "Número"],
  ["data", "Data"],
  ["lista_opcoes", "Lista de opções"],
  ["oculto", "Campo oculto"],
];

const vazio = { chave: "", rotulo: "", tipo: "texto", grupo: "Geral", opcoes: "" };

export default function Campos() {
  const { podeOperar } = useSessao();
  const [campos, setCampos] = useState<Campo[]>([]);
  const [emUso, setEmUso] = useState<EmUso[]>([]);
  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [editando, setEditando] = useState<Campo | "novo" | null>(null);
  const [form, setForm] = useState(vazio);

  async function carregar() {
    const [c, u] = await Promise.all([
      supabase.from("campos_personalizados").select("*").order("grupo").order("ordem").order("chave"),
      supabase.rpc("campos_em_uso"),
    ]);
    setCampos((c.data as never) ?? []);
    setEmUso(((u.data as never) ?? []) as EmUso[]);
  }
  useEffect(() => { carregar(); }, []);

  const usoPor = Object.fromEntries(emUso.map((u) => [u.chave, u]));
  const orfaos = emUso.filter((u) => !u.cadastrado);

  const filtrados = campos.filter((c) =>
    (!fTipo || c.tipo === fTipo) &&
    (!busca.trim() ||
      c.rotulo.toLowerCase().includes(busca.toLowerCase()) ||
      c.chave.toLowerCase().includes(busca.toLowerCase())));

  const grupos = [...new Set(filtrados.map((c) => c.grupo))];

  function abrir(c: Campo | null, chavePronta = "") {
    setEditando(c ?? "novo");
    setForm(c
      ? { chave: c.chave, rotulo: c.rotulo, tipo: c.tipo, grupo: c.grupo, opcoes: (c.opcoes ?? []).join(", ") }
      : { ...vazio, chave: chavePronta, rotulo: chavePronta });
  }

  async function salvar() {
    const chave = form.chave.trim();
    if (!chave || !form.rotulo.trim()) { alert("Preencha a variável e o nome do campo."); return; }
    const dados = {
      chave, rotulo: form.rotulo.trim(), tipo: form.tipo,
      grupo: form.grupo.trim() || "Geral",
      opcoes: form.tipo === "lista_opcoes"
        ? form.opcoes.split(",").map((s) => s.trim()).filter(Boolean)
        : null,
    };
    const r = editando === "novo"
      ? await supabase.from("campos_personalizados").insert(dados)
      : await supabase.from("campos_personalizados").update(dados)
          .eq("campo_id", (editando as Campo).campo_id);
    if (r.error) { alert(r.error.message); return; }
    setEditando(null); carregar();
  }

  async function excluir(c: Campo) {
    const uso = usoPor[c.chave]?.leads ?? 0;
    if (!confirm(
      `Remover o campo "${c.rotulo}" do cadastro?\n\n` +
      (uso > 0
        ? `Atenção: ${uso} contatos têm valor nesse campo. Os valores NÃO são apagados — ` +
          `o campo só deixa de ter nome e volta a aparecer como "${c.chave}".`
        : "Nenhum contato usa esse campo."))) return;
    await supabase.from("campos_personalizados").delete().eq("campo_id", c.campo_id);
    carregar();
  }

  return (
    <div>
      <h1>Campos</h1>
      <div className="sub">
        Informação extra que fica guardada em cada contato — origem, UTM, respostas de
        formulário. Dá para filtrar por eles no segmento avançado e escrever a variável
        direto no e-mail. Campo sem valor naquele contato sai como vazio, nunca aparece cru.
      </div>

      <div className="caixa linha">
        <input placeholder="Buscar campo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select style={{ flex: "0 0 190px" }} value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Qualquer tipo</option>
          {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        {podeOperar && (
          <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => abrir(null)}>
            + Adicionar campo
          </button>
        )}
      </div>

      {orfaos.length > 0 && (
        <div className="aviso">
          <b>{orfaos.length} campo(s) aparecem nos dados mas não estão cadastrados aqui.</b> Eles
          funcionam do mesmo jeito, só ficam sem nome legível.{" "}
          {orfaos.slice(0, 6).map((o) => (
            <button key={o.chave} style={{ margin: "4px 4px 0 0" }} onClick={() => abrir(null, o.chave)}>
              cadastrar {o.chave} ({o.leads})
            </button>
          ))}
        </div>
      )}

      {grupos.map((g) => (
        <div className="caixa" key={g}>
          <h2>{g}</h2>
          <table>
            <thead><tr>
              <th>Nome do campo</th><th>Tipo</th><th>Variável no e-mail</th><th>Contatos</th><th></th>
            </tr></thead>
            <tbody>
              {filtrados.filter((c) => c.grupo === g).map((c) => (
                <tr key={c.campo_id}>
                  <td><b>{c.rotulo}</b></td>
                  <td>{TIPOS.find(([v]) => v === c.tipo)?.[1] ?? c.tipo}</td>
                  <td>
                    <code style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                      {`{{campo.${c.chave}}}`}
                    </code>
                    {c.perstag && (
                      <div style={{ color: "var(--texto2)", fontSize: "calc(11.5px * var(--escala-texto))", marginTop: 2 }}>
                        também aceita <code>%{c.perstag}%</code>
                      </div>
                    )}
                  </td>
                  <td>
                    {usoPor[c.chave]?.leads
                      ? Number(usoPor[c.chave].leads).toLocaleString("pt-BR")
                      : <span style={{ color: "var(--texto2)" }}>0</span>}
                  </td>
                  <td className="direita" style={{ whiteSpace: "nowrap" }}>
                    {podeOperar && <>
                      <button onClick={() => abrir(c)}>Editar</button>{" "}
                      <button className="perigo" onClick={() => excluir(c)}>Excluir</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {!campos.length && (
        <div className="caixa"><span className="sub">Nenhum campo cadastrado ainda.</span></div>
      )}

      {editando && (
        <div className="gaveta" style={{ width: 460 }}>
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>
          <h2>{editando === "novo" ? "Novo campo" : "Editar campo"}</h2>

          <label>Nome do campo</label>
          <input value={form.rotulo} placeholder="Origem do cadastro"
            onChange={(e) => setForm({ ...form, rotulo: e.target.value })} />

          <label>Variável (a chave onde o valor fica guardado)</label>
          <input value={form.chave} placeholder="origem_cadastro"
            disabled={editando !== "novo"}
            onChange={(e) => setForm({ ...form, chave: e.target.value })} />
          {editando !== "novo" && (
            <div className="sub" style={{ marginTop: 4 }}>
              A variável não muda depois de criada: os valores já gravados em milhares de
              contatos estão presos a ela. Para trocar, crie um campo novo.
            </div>
          )}

          <label>Tipo</label>
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          {form.tipo === "oculto" && (
            <div className="sub" style={{ marginTop: 4 }}>
              Campo oculto não aparece em formulário — é para dado que o sistema preenche
              sozinho, como UTM de campanha.
            </div>
          )}

          {form.tipo === "lista_opcoes" && (
            <>
              <label>Opções (separadas por vírgula)</label>
              <input value={form.opcoes} placeholder="Instagram, YouTube, Indicação"
                onChange={(e) => setForm({ ...form, opcoes: e.target.value })} />
            </>
          )}

          <label>Grupo</label>
          <input value={form.grupo} placeholder="Geral"
            onChange={(e) => setForm({ ...form, grupo: e.target.value })} />
          <div className="sub" style={{ marginTop: 4 }}>
            Serve só para organizar esta tela. Campos do mesmo lançamento juntos ficam
            bem mais fáceis de achar.
          </div>

          <div className="linha" style={{ marginTop: 18 }}>
            <button className="primario" onClick={salvar}>Salvar</button>
            <button onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
