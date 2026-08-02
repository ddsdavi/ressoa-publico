import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";

// Formulários de captação: monta aqui, publica num endereço próprio.
//
// A lista e a tag de destino ficam guardadas NO FORMULÁRIO, não são
// enviadas pela página. Assim ninguém consegue, chamando o endereço por
// fora, inscrever gente numa lista que o formulário não deveria tocar.

type Campo = { campo: string; rotulo: string; obrigatorio?: boolean };
type Form = {
  formulario_id: string; slug: string; nome: string; titulo: string; subtitulo: string;
  campos: Campo[]; lista_fk: number | null; tag_fk: number | null;
  botao: string; sucesso: string; redirecionar: string | null;
  cor: string; ativo: boolean; envios: number; created_at: string;
};

const PADRAO: Campo[] = [
  { campo: "nome", rotulo: "Seu nome", obrigatorio: true },
  { campo: "email", rotulo: "Seu melhor e-mail", obrigatorio: true },
];

const vazio = {
  slug: "", nome: "", titulo: "", subtitulo: "", campos: PADRAO,
  lista_fk: "", tag_fk: "", botao: "Quero participar",
  sucesso: "Pronto! Confira seu e-mail.", redirecionar: "", cor: "#6b4ea8", ativo: true,
};

export default function Formularios() {
  const { podeOperar } = useSessao();
  const [forms, setForms] = useState<Form[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [tags, setTags] = useState<{ tag_id: number; nome: string }[]>([]);
  const [campos, setCampos] = useState<{ chave: string; rotulo: string }[]>([]);
  const [editando, setEditando] = useState<Form | "novo" | null>(null);
  const [f, setF] = useState<typeof vazio>(vazio);

  const base = location.origin;

  async function carregar() {
    const [a, l, t, c] = await Promise.all([
      supabase.from("formularios").select("*").order("created_at", { ascending: false }),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("tags").select("tag_id, nome").order("nome"),
      supabase.from("campos_personalizados").select("chave, rotulo").order("rotulo"),
    ]);
    setForms((a.data as never) ?? []);
    setListas(l.data ?? []);
    setTags((t.data ?? []) as never);
    setCampos((c.data ?? []) as never);
  }
  useEffect(() => { carregar(); }, []);

  function abrir(x: Form | null) {
    setEditando(x ?? "novo");
    setF(x
      ? {
        slug: x.slug, nome: x.nome, titulo: x.titulo, subtitulo: x.subtitulo,
        campos: x.campos ?? PADRAO,
        lista_fk: x.lista_fk ? String(x.lista_fk) : "",
        tag_fk: x.tag_fk ? String(x.tag_fk) : "",
        botao: x.botao, sucesso: x.sucesso, redirecionar: x.redirecionar ?? "",
        cor: x.cor, ativo: x.ativo,
      }
      : vazio);
  }

  const gerarSlug = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

  async function salvar() {
    const slug = gerarSlug(f.slug || f.nome);
    if (!slug || !f.nome.trim()) { alert("Dê um nome ao formulário."); return; }
    if (!f.campos.some((c) => c.campo === "email")) {
      alert("O formulário precisa ter o campo de e-mail — é ele que identifica a pessoa.");
      return;
    }
    const dados = {
      slug, nome: f.nome.trim(), titulo: f.titulo.trim(), subtitulo: f.subtitulo.trim(),
      campos: f.campos,
      lista_fk: f.lista_fk ? Number(f.lista_fk) : null,
      tag_fk: f.tag_fk ? Number(f.tag_fk) : null,
      botao: f.botao.trim() || "Enviar",
      sucesso: f.sucesso.trim(),
      redirecionar: f.redirecionar.trim() || null,
      cor: f.cor, ativo: f.ativo, updated_at: new Date().toISOString(),
    };
    const r = editando === "novo"
      ? await supabase.from("formularios").insert(dados)
      : await supabase.from("formularios").update(dados)
          .eq("formulario_id", (editando as Form).formulario_id);
    if (r.error) {
      alert(r.error.message.includes("duplicate")
        ? `Já existe um formulário com o endereço "${slug}". Mude o nome.`
        : r.error.message);
      return;
    }
    setEditando(null); carregar();
  }

  async function excluir(x: Form) {
    if (!confirm(
      `Excluir o formulário "${x.nome}"?\n\n` +
      (x.envios > 0
        ? `Ele já recebeu ${x.envios} cadastro(s). Os leads NÃO são apagados — só o formulário. ` +
          "Mas o endereço para de funcionar na hora, e quem tiver o link vai ver erro."
        : "Nunca recebeu cadastro."))) return;
    await supabase.from("formularios").delete().eq("formulario_id", x.formulario_id);
    carregar();
  }

  function mudarCampo(i: number, patch: Partial<Campo>) {
    setF({ ...f, campos: f.campos.map((c, x) => (x === i ? { ...c, ...patch } : c)) });
  }

  return (
    <div>
      <h1>Formulários</h1>
      <div className="sub">
        Página de captação hospedada no seu próprio domínio. Quem preenche entra na base
        na hora, e as automações da lista e da tag escolhidas disparam sozinhas.
      </div>

      {podeOperar && (
        <div className="caixa">
          <button className="primario" onClick={() => abrir(null)}>+ Novo formulário</button>
        </div>
      )}

      <div className="caixa">
        <table>
          <thead><tr>
            <th>Formulário</th><th>Endereço</th><th>Destino</th><th>Cadastros</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {forms.map((x) => (
              <tr key={x.formulario_id}>
                <td><b>{x.nome}</b>
                  <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                    {x.titulo}
                  </div>
                </td>
                <td>
                  <a href={`${base}/f/${x.slug}`} target="_blank" rel="noreferrer"
                     style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                    /f/{x.slug}
                  </a>
                </td>
                <td style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  {listas.find((l) => l.lista_id === x.lista_fk)?.nome ?? "—"}
                  {x.tag_fk && <div style={{ color: "var(--texto2)" }}>
                    tag: {tags.find((t) => t.tag_id === x.tag_fk)?.nome}</div>}
                </td>
                <td>{x.envios}</td>
                <td>
                  <span className={`etiqueta ${x.ativo ? "et-verde" : "et-cinza"}`}>
                    {x.ativo ? "no ar" : "desligado"}
                  </span>
                </td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => navigator.clipboard?.writeText(`${base}/f/${x.slug}`)}>
                    Copiar link
                  </button>{" "}
                  {podeOperar && <>
                    <button onClick={() => abrir(x)}>Editar</button>{" "}
                    <button className="perigo" onClick={() => excluir(x)}>Excluir</button>
                  </>}
                </td>
              </tr>
            ))}
            {!forms.length && (
              <tr><td colSpan={6} style={{ color: "var(--texto2)" }}>Nenhum formulário ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="gaveta" style={{ width: 560 }}>
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>
          <h2>{editando === "novo" ? "Novo formulário" : "Editar formulário"}</h2>

          <label>Nome interno</label>
          <input value={f.nome} placeholder="Captação Lives Semanais"
            onChange={(e) => setF({ ...f, nome: e.target.value })} />

          <label>Endereço da página</label>
          <div className="linha" style={{ alignItems: "center" }}>
            <span style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))", flex: "0 0 auto" }}>
              {base}/f/
            </span>
            <input value={f.slug} placeholder={gerarSlug(f.nome) || "lives-semanais"}
              onChange={(e) => setF({ ...f, slug: e.target.value })} />
          </div>

          <label>Título que a pessoa vê</label>
          <input value={f.titulo} placeholder="Receba os avisos das aulas"
            onChange={(e) => setF({ ...f, titulo: e.target.value })} />

          <label>Frase de apoio</label>
          <input value={f.subtitulo} placeholder="Deixe seu melhor e-mail e avisamos antes de cada encontro."
            onChange={(e) => setF({ ...f, subtitulo: e.target.value })} />

          <label>Campos do formulário</label>
          {f.campos.map((c, i) => (
            <div className="linha" key={i} style={{ marginBottom: 6 }}>
              <input style={{ flex: 2 }} value={c.rotulo}
                onChange={(e) => mudarCampo(i, { rotulo: e.target.value })} />
              <span style={{ flex: "0 0 120px", color: "var(--texto2)",
                             fontSize: "calc(12px * var(--escala-texto))" }}>{c.campo}</span>
              <label style={{ flex: "0 0 auto" }}>
                <input type="checkbox" checked={!!c.obrigatorio}
                  onChange={(e) => mudarCampo(i, { obrigatorio: e.target.checked })} />
                obrigatório
              </label>
              <button className="perigo" style={{ flex: "0 0 auto" }}
                disabled={c.campo === "email"}
                title={c.campo === "email" ? "o e-mail é obrigatório: é ele que identifica a pessoa" : ""}
                onClick={() => setF({ ...f, campos: f.campos.filter((_, x) => x !== i) })}>−</button>
            </div>
          ))}
          <div className="linha">
            <select value="" onChange={(e) => {
              if (!e.target.value) return;
              const [campo, rotulo] = e.target.value.split("|");
              if (f.campos.some((c) => c.campo === campo)) return;
              setF({ ...f, campos: [...f.campos, { campo, rotulo }] });
            }}>
              <option value="">+ adicionar campo…</option>
              <option value="whatsapp|WhatsApp">WhatsApp</option>
              {campos.map((c) => (
                <option key={c.chave} value={`${c.chave}|${c.rotulo}`}>{c.rotulo}</option>
              ))}
            </select>
          </div>

          <div className="linha">
            <div style={{ flex: 1 }}>
              <label>Inscreve na lista</label>
              <select value={f.lista_fk} onChange={(e) => setF({ ...f, lista_fk: e.target.value })}>
                <option value="">nenhuma</option>
                {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Aplica a tag</label>
              <select value={f.tag_fk} onChange={(e) => setF({ ...f, tag_fk: e.target.value })}>
                <option value="">nenhuma</option>
                {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
              </select>
            </div>
          </div>
          <div className="aviso" style={{ marginTop: 8 }}>
            Entrar na lista ou receber a tag <b>dispara as automações ligadas a elas</b> —
            inclusive as que mandam e-mail. Confira em Automações antes de publicar.
          </div>

          <div className="linha">
            <div style={{ flex: 2 }}>
              <label>Texto do botão</label>
              <input value={f.botao} onChange={(e) => setF({ ...f, botao: e.target.value })} />
            </div>
            <div style={{ flex: "0 0 110px" }}>
              <label>Cor</label>
              <input type="color" value={f.cor} style={{ padding: 3 }}
                onChange={(e) => setF({ ...f, cor: e.target.value })} />
            </div>
          </div>

          <label>Mensagem depois de enviar</label>
          <input value={f.sucesso} onChange={(e) => setF({ ...f, sucesso: e.target.value })} />

          <label>Ou redirecionar para (opcional)</label>
          <input value={f.redirecionar} placeholder="https://…"
            onChange={(e) => setF({ ...f, redirecionar: e.target.value })} />

          <label style={{ marginTop: 14 }}>
            <input type="checkbox" checked={f.ativo}
              onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            No ar (desmarcado, o endereço para de responder)
          </label>

          <div className="linha" style={{ marginTop: 18 }}>
            <button className="primario" onClick={salvar}>Salvar</button>
            <button onClick={() => setEditando(null)}>Cancelar</button>
            {editando !== "novo" && (
              <a className="botao" href={`${base}/f/${(editando as Form).slug}`}
                 target="_blank" rel="noreferrer" style={{ flex: "0 0 auto", lineHeight: "36px" }}>
                Ver a página
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
