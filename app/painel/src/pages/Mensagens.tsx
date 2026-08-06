import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import EditorEmail from "../components/EditorEmail";
import Ajuda from "../components/Ajuda";

type Msg = {
  mensagem_id: string; nome: string; from_name: string; from_email: string;
  subject: string; preheader: string | null; html: string; design: unknown | null;
  origem_ac_id: number | null; created_at: string;
};

export default function Mensagens() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Msg | null>(null);
  const [editando, setEditando] = useState(false);
  const [editorVisual, setEditorVisual] = useState(false);
  const [form, setForm] = useState({ nome: "", subject: "", preheader: "", from_name: "", from_email: "", html: "" });
  const [padrao, setPadrao] = useState({ nome: "", email: "" });
  const [formDesign, setFormDesign] = useState<unknown | null>(null);

  async function carregar() {
    const { data } = await supabase.from("mensagens")
      .select("mensagem_id, nome, from_name, from_email, subject, preheader, html, design, origem_ac_id, created_at")
      .order("created_at", { ascending: false }).limit(300);
    setMsgs((data as never) ?? []);
  }
  useEffect(() => { carregar(); }, []);

  // o remetente novo nasce do que está em Configurações — não de um valor
  // fixo no código, que envelhece e passa a apontar para domínio errado
  useEffect(() => {
    supabase.from("app_config").select("chave, valor")
      .in("chave", ["from_name_padrao", "from_email_padrao"]).then(({ data }) => {
        const c = Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor ?? ""]));
        setPadrao({ nome: c.from_name_padrao ?? "", email: c.from_email_padrao ?? "" });
      });
  }, []);

  const filtradas = msgs.filter((m) =>
    !busca.trim() ||
    m.nome?.toLowerCase().includes(busca.toLowerCase()) ||
    m.subject?.toLowerCase().includes(busca.toLowerCase()));

  function abrirEdicao(m: Msg | null) {
    setEditando(true);
    setFormDesign(m?.design ?? null);
    setForm(m
      ? {
        nome: m.nome, subject: m.subject, preheader: m.preheader ?? "",
        from_name: m.from_name, from_email: m.from_email, html: m.html,
      }
      : {
        nome: "", subject: "", preheader: "",
        from_name: padrao.nome, from_email: padrao.email, html: "",
      });
  }

  async function salvar() {
    if (sel && !confirm("Salvar alterações nesta mensagem? Campanhas futuras usarão a nova versão.")) return;
    const payload = { ...form, design: formDesign ?? null, updated_at: new Date().toISOString() };
    const r = sel
      ? await supabase.from("mensagens").update(payload).eq("mensagem_id", sel.mensagem_id)
      : await supabase.from("mensagens").insert(payload);
    if (r.error) { alert(r.error.message); return; }
    setEditando(false); setSel(null); carregar();
  }

  async function duplicar(m: Msg) {
    await supabase.from("mensagens").insert({
      nome: m.nome + " (cópia)", subject: m.subject, from_name: m.from_name,
      from_email: m.from_email, preheader: m.preheader, html: m.html, design: m.design ?? null,
    });
    carregar();
  }

  return (
    <div>
      <h1>Mensagens</h1>
      <div className="sub">{msgs.length} e-mails na biblioteca (importados do ActiveCampaign + novos)
        <Ajuda>
          É daqui que as <b>automações</b> puxam o que enviar — o passo “enviar e-mail”
          escolhe uma mensagem desta lista.
          <br /><br />
          Campanha é diferente: nela você escreve o e-mail ali mesmo, e ele é guardado aqui
          depois. Editar uma mensagem não mexe no que já foi enviado, mas vale para as
          próximas vezes que uma automação usar essa mensagem.
        </Ajuda>
      </div>
      <div className="caixa linha">
        <input placeholder="Buscar por nome ou assunto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => { setSel(null); abrirEdicao(null); }}>+ Nova mensagem</button>
      </div>
      <div className="caixa">
        <table>
          <thead><tr>
            <th>Nome<Ajuda>O nome interno, só para você achar a mensagem depois. Quem recebe nunca vê isto — vê o assunto.</Ajuda></th>
            <th>Assunto<Ajuda>O que aparece na caixa de entrada. Aceita {"{{nome}}"} para chamar cada pessoa pelo primeiro nome.</Ajuda></th>
            <th>Remetente<Ajuda>Nome e endereço que assinam o e-mail. Nasce do que está em Configurações, e pode ser mudado por mensagem.</Ajuda></th>
            <th>Origem<Ajuda><b>AC #</b> veio da migração do ActiveCampaign, com o número original de lá. <b>Própria</b> foi escrita aqui. As duas funcionam igual.</Ajuda></th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtradas.map((m) => (
              <tr key={m.mensagem_id}>
                <td>{m.nome}</td>
                <td>{m.subject}</td>
                <td>{m.from_name} <span style={{ color: "var(--texto2)" }}>&lt;{m.from_email}&gt;</span></td>
                <td>{m.origem_ac_id
                  ? <span className="etiqueta et-cinza">AC #{m.origem_ac_id}</span>
                  : <span className="etiqueta et-roxa">própria</span>}</td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => { setSel(m); setEditando(false); }}>Ver</button>{" "}
                  <button onClick={() => { setSel(m); abrirEdicao(m); }}>Editar</button>{" "}
                  <button onClick={() => duplicar(m)}>Duplicar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(sel || editando) && !editorVisual && (
        <div className="gaveta" style={{ width: 640 }}>
          <button className="fechar" onClick={() => { setSel(null); setEditando(false); }}>✕</button>
          {!editando && sel ? (
            <>
              <h2>{sel.nome}</h2>
              <div className="sub">{sel.subject}</div>
              <iframe className="previa" title="prévia" srcDoc={sel.html} sandbox="" />
            </>
          ) : (
            <>
              <h2>{sel ? "Editar mensagem" : "Nova mensagem"}</h2>
              <label>Nome interno</label>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              <label>Assunto (aceita {"{{nome}}"})
                <Ajuda>
                  Quem não tem nome cadastrado recebe o assunto sem a variável, nunca com{" "}
                  {"{{nome}}"} escrito no meio.
                  <br /><br />
                  Também valem os seus campos próprios: <code>{"{{campo.cidade}}"}</code>, por
                  exemplo. A lista completa está em <b>Campos</b>.
                </Ajuda>
              </label>
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              <label>Texto de prévia
                <Ajuda>
                  O trecho cinza que o Gmail mostra ao lado do assunto, antes de a pessoa
                  abrir. Depois do assunto, é o que mais mexe na taxa de abertura — e a
                  maioria dos e-mails desperdiça esse espaço.
                </Ajuda>
              </label>
              <input value={form.preheader} maxLength={140}
                placeholder="o trecho que aparece ao lado do assunto na caixa de entrada"
                onChange={(e) => setForm({ ...form, preheader: e.target.value })} />
              <div className="sub" style={{ marginTop: 4 }}>
                Depois do assunto, é o que mais mexe na taxa de abertura. Se ficar vazio, o
                cliente de e-mail mostra as primeiras palavras do corpo — quase sempre algo
                sem graça. Ideal entre 40 e 100 caracteres ({form.preheader.length} agora).
              </div>
              <div className="linha">
                <div><label>Nome do remetente</label>
                  <input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} /></div>
                <div><label>E-mail do remetente</label>
                  <input value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} /></div>
              </div>
              <label>Conteúdo
                <Ajuda>
                  O editor visual monta o e-mail em blocos de arrastar e soltar, com as
                  cores e a fonte definidas em <b>Configurações → Aparência dos e-mails</b>.
                  <br /><br />
                  No envio, o sistema acrescenta sozinho o pixel de abertura, o rastreio dos
                  links, o descadastro e o endereço no rodapé — não precisa escrever nada
                  disso.
                </Ajuda>
              </label>
              <div className="linha" style={{ marginBottom: 8 }}>
                <button className="primario" onClick={() => setEditorVisual(true)}>🎨 Abrir editor visual</button>
              </div>
              {form.html && (
                <iframe className="previa" style={{ height: 260 }} title="prévia" srcDoc={form.html} sandbox="" />
              )}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--texto2)", cursor: "pointer" }}>editar HTML manualmente</summary>
                <div className="sub" style={{ marginTop: 6 }}>
                  Só para quem sabe HTML de e-mail.
                  <Ajuda>
                    Mexer aqui <b>desfaz o vínculo com o editor visual</b>: os blocos são
                    esquecidos e a mensagem passa a ser só o HTML que estiver escrito. Não dá
                    para voltar atrás depois de salvar.
                    <br /><br />
                    E-mail não é página: use tabelas e estilo na própria tag, porque boa
                    parte dos clientes ignora CSS externo.
                  </Ajuda>
                </div>
                <textarea rows={10} style={{ fontFamily: "monospace", fontSize: "calc(12px * var(--escala-texto))", marginTop: 6 }}
                  value={form.html} onChange={(e) => { setForm({ ...form, html: e.target.value }); setFormDesign(null); }} />
              </details>
              <div className="linha" style={{ marginTop: 14 }}>
                <button className="primario" onClick={salvar}>Salvar</button>
                <button onClick={() => { setEditando(false); setSel(null); }}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {editorVisual && (
        <EditorEmail
          html={form.html}
          design={formDesign}
          onSalvar={(html, design) => { setForm({ ...form, html }); setFormDesign(design); setEditorVisual(false); }}
          onFechar={() => setEditorVisual(false)}
        />
      )}
    </div>
  );
}
