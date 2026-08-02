import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Ajuda from "../components/Ajuda";

// Operar o ManyChat sem sair da Ressoa: ver e criar tags, procurar alguém
// pelo WhatsApp, criar quem não existe e marcar.
//
// É a mesma sequência do n8n — formata o telefone, procura pelo campo
// personalizado, e se não achar cria antes de marcar. A diferença é que
// aqui dá para rodar um passo de cada vez e ver a resposta. Antes de ligar
// um fluxo que manda WhatsApp para gente de verdade, isso é o que separa
// "acho que funciona" de "vi funcionando".

const FUNCOES = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manychat`;
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

async function chamar(corpo: Record<string, unknown>) {
  const r = await fetch(FUNCOES, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CHAVE },
    body: JSON.stringify(corpo),
  });
  return r.json();
}

type Tag = { id: number; name: string };
type Achado = {
  id: number; nome: string; status: string; whatsapp: string; tags: string[];
};
type Lead = { lead_id: string; nome: string | null; email: string; whatsapp: string | null };
type Produto = {
  id: number; apelido: string;
  tag_manychat: string | null; tag_manychat_turma: boolean;
};

export default function ManyChat() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroGeral, setErroGeral] = useState("");
  const [filtro, setFiltro] = useState("");
  const [novaTag, setNovaTag] = useState("");
  const [recado, setRecado] = useState("");

  // procurar / criar
  const [fone, setFone] = useState("");
  const [nome, setNome] = useState("");
  const [formatado, setFormatado] = useState("");
  const [achado, setAchado] = useState<Achado | null>(null);
  const [procurou, setProcurou] = useState(false);
  const [tagEscolhida, setTagEscolhida] = useState("");
  const [ocupado, setOcupado] = useState("");

  // testar com alguém da base
  const [busca, setBusca] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);

  // rodar a regra de um produto
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [tNome, setTNome] = useState("");
  const [tFone, setTFone] = useState("");
  const [tEmail, setTEmail] = useState("");
  const [tProduto, setTProduto] = useState("");
  const [resultado, setResultado] = useState<Record<string, any> | null>(null);

  async function carregarTags() {
    setCarregando(true);
    const d = await chamar({ acao: "tags" });
    if (d.ok) { setTags(d.tags ?? []); setErroGeral(""); }
    else setErroGeral(d.erro ?? "Não deu para ler as tags. Confira a chave em Configurações → ManyChat.");
    setCarregando(false);
  }
  useEffect(() => { carregarTags(); }, []);

  useEffect(() => {
    supabase.from("hotmart_produtos")
      .select("id,apelido,tag_manychat,tag_manychat_turma").eq("ativo", true).order("apelido")
      .then(({ data }) => setProdutos((data as Produto[]) ?? []));
  }, []);

  async function criarTag() {
    if (!novaTag.trim()) return;
    setOcupado("Criando a tag…");
    const d = await chamar({ acao: "criar_tag", tag: novaTag.trim() });
    setRecado(d.mensagem ?? (d.ok ? "criada" : "não deu"));
    setNovaTag("");
    setOcupado("");
    carregarTags();
  }

  async function procurar() {
    setOcupado("Procurando…");
    setProcurou(false); setAchado(null);
    const d = await chamar({ acao: "procurar", whatsapp: fone });
    setFormatado(d.formatado ?? "");
    setAchado(d.existe ? d.assinante : null);
    setProcurou(true);
    setRecado(d.erro ?? "");
    setOcupado("");
  }

  async function criar() {
    setOcupado("Criando no ManyChat…");
    const d = await chamar({ acao: "criar", whatsapp: fone, nome });
    setOcupado("");
    if (!d.ok) { setRecado("Não deu para criar: " + JSON.stringify(d.detalhe ?? d.erro)); return; }
    setRecado(`Criado no ManyChat (assinante ${d.assinante}).`);
    procurar();
  }

  async function marcar(remover = false) {
    if (!achado || !tagEscolhida) return;
    setOcupado(remover ? "Removendo…" : "Marcando…");
    const d = remover
      ? await chamar({ acao: "desmarcar", manychat_id: String(achado.id), tag: tagEscolhida })
      : await chamar({ manychat_id: String(achado.id), tag: tagEscolhida, criar: false });
    setOcupado("");
    setRecado(d.ok
      ? `${remover ? "Removida" : "Aplicada"} a tag ${tagEscolhida} — confira no ManyChat.`
      : "Não deu: " + JSON.stringify(d.detalhe ?? d));
    procurar();
  }

  async function procurarLead() {
    if (busca.trim().length < 3) { setLeads([]); return; }
    const t = `%${busca.trim()}%`;
    const { data } = await supabase.from("tabela_1_leads")
      .select("lead_id,nome,email,whatsapp")
      .or(`email.ilike.${t},nome.ilike.${t},whatsapp.ilike.${t}`)
      .limit(8);
    setLeads((data as Lead[]) ?? []);
  }

  async function rodarRegra() {
    setResultado(null);
    setOcupado("Rodando a regra…");
    const { data, error } = await supabase.rpc("testar_regra_produto", {
      p_nome: tNome.trim() || null,
      p_whatsapp: tFone.trim(),
      p_email: tEmail.trim() || null,
      p_produto_id: Number(tProduto),
    });
    setOcupado("");
    if (error) { setResultado({ ok: false, erro: error.message }); return; }
    setResultado(data as Record<string, any>);
    // já deixa o número carregado acima, para conferir as tags de lá
    if (!fone.trim()) setFone(tFone);
  }

  const produtoEscolhido = produtos.find((p) => String(p.id) === tProduto);

  const tagsFiltradas = tags.filter((t) =>
    !filtro.trim() || t.name.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div>
      <h1>ManyChat</h1>
      <div className="sub">Procurar, criar e marcar gente lá dentro, um passo de cada vez.</div>

      {erroGeral && <div className="aviso">{erroGeral}</div>}
      {(ocupado || recado) && (
        <div className={ocupado ? "sub" : "aviso"} style={{ marginTop: 10 }}>
          {ocupado || recado}
        </div>
      )}

      {/* ---------------- procurar e criar ---------------- */}
      <div className="caixa">
        <h2>Procurar pelo WhatsApp
          <Ajuda>
            Pode digitar de qualquer jeito — com DDI, sem DDI, com parênteses. O número é
            acertado antes de procurar, porque a busca lá é exata: um dígito de diferença
            e a pessoa "não existe".
          </Ajuda>
        </h2>

        <div className="linha" style={{ marginTop: 12 }}>
          <div style={{ flex: 2 }}>
            <label>WhatsApp</label>
            <input value={fone} placeholder="(51) 99164-3377"
              onChange={(e) => setFone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && procurar()} />
          </div>
          <div style={{ flex: 2 }}>
            <label>Nome (só para criar)</label>
            <input value={nome} placeholder="Maria Silva"
              onChange={(e) => setNome(e.target.value)} />
          </div>
          <button className="primario" style={{ flex: "0 0 auto", alignSelf: "flex-end" }}
            onClick={procurar} disabled={!fone.trim()}>Procurar</button>
        </div>

        {formatado && (
          <div className="sub" style={{ marginTop: 6 }}>
            Vai procurar por <b>{formatado}</b> — é como o número fica depois de acertado.
          </div>
        )}

        {procurou && !achado && (
          <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 8,
                        border: "1px solid var(--borda)" }}>
            <b>Não existe no ManyChat.</b>
            <Ajuda>
              É o mesmo caminho da automação: quando não acha, cria. Sem WhatsApp válido
              não dá — assinante sem número nunca receberia nada.
            </Ajuda>
            <div style={{ height: 10 }} />
            <button className="primario" onClick={criar} disabled={!formatado}>
              Criar esta pessoa no ManyChat
            </button>
          </div>
        )}

        {achado && (
          <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 8,
                        border: "2px solid var(--marca)", background: "var(--marca-fraca)" }}>
            <b>{achado.nome || "(sem nome)"}</b>
            <span className="sub"> · assinante {achado.id} · {achado.status}</span>
            <div className="sub" style={{ margin: "2px 0 10px" }}>{achado.whatsapp}</div>

            <div style={{ marginBottom: 10 }}>
              {achado.tags.length
                ? achado.tags.map((t) => (
                    <span key={t} className="etiqueta et-roxa" style={{ marginRight: 6 }}>{t}</span>
                  ))
                : <span className="sub">nenhuma tag ainda</span>}
            </div>

            <div className="linha">
              <select value={tagEscolhida} style={{ flex: 2 }}
                onChange={(e) => setTagEscolhida(e.target.value)}>
                <option value="">— escolher a tag —</option>
                {tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button className="primario" style={{ flex: "0 0 auto" }}
                onClick={() => marcar(false)} disabled={!tagEscolhida}>Aplicar</button>
              <button style={{ flex: "0 0 auto" }}
                onClick={() => marcar(true)} disabled={!tagEscolhida}>Remover</button>
            </div>
            <div className="sub" style={{ marginTop: 6 }}>
              Aplicar uma tag manda WhatsApp de verdade.
              <Ajuda>
                A tag dispara o fluxo do ManyChat ligado a ela. Para experimentar sem que
                nada seja enviado, crie uma tag nova aqui embaixo — tag recém-criada não
                tem automação pendurada em lugar nenhum.
              </Ajuda>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- puxar alguém da base ---------------- */}
      <div className="caixa">
        <h2>Trazer alguém da Ressoa</h2>
        <div className="linha" style={{ marginTop: 10 }}>
          <input value={busca} placeholder="nome, e-mail ou telefone"
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && procurarLead()} />
          <button style={{ flex: "0 0 auto" }} onClick={procurarLead}>Procurar</button>
        </div>
        {!!leads.length && (
          <table className="tabela" style={{ marginTop: 10 }}>
            <tbody>
              {leads.map((l) => (
                <tr key={l.lead_id}>
                  <td>{l.nome || <i>sem nome</i>}</td>
                  <td className="sub">{l.email}</td>
                  <td>{l.whatsapp || <i className="sub">sem WhatsApp</i>}</td>
                  <td className="direita">
                    <button disabled={!l.whatsapp}
                      onClick={() => { setFone(l.whatsapp ?? ""); setNome(l.nome ?? ""); }}>
                      usar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---------------- rodar a regra de um produto ---------------- */}
      <div className="caixa" style={{ borderLeft: "4px solid var(--marca)" }}>
        <h2>Rodar a automação de um produto
          <Ajuda>
            Faz o mesmo que uma compra aprovada: acha ou cria o contato aqui, entra na
            lista, ganha a tag da turma e é marcado no ManyChat. Nada é fingido — a pessoa
            aparece lá de verdade. <b>Não registra venda:</b> teste não pode virar
            faturamento no relatório.
          </Ajuda>
        </h2>

        <div className="linha" style={{ marginTop: 12 }}>
          <div style={{ flex: 2 }}>
            <label>Nome</label>
            <input value={tNome} onChange={(e) => setTNome(e.target.value)} placeholder="Maria de Teste" />
          </div>
          <div style={{ flex: 2 }}>
            <label>WhatsApp</label>
            <input value={tFone} onChange={(e) => setTFone(e.target.value)} placeholder="(51) 99999-0000" />
          </div>
        </div>
        <div className="linha">
          <div style={{ flex: 2 }}>
            <label>E-mail (opcional)</label>
            <input value={tEmail} onChange={(e) => setTEmail(e.target.value)} />
          </div>
          <div style={{ flex: 2 }}>
            <label>Produto</label>
            <select value={tProduto} onChange={(e) => setTProduto(e.target.value)}>
              <option value="">— escolher —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.apelido}{p.tag_manychat ? ` → ${p.tag_manychat}` : " (sem tag do ManyChat)"}
                </option>
              ))}
            </select>
          </div>
          <button className="primario" style={{ flex: "0 0 auto", alignSelf: "flex-end" }}
            onClick={rodarRegra} disabled={!tFone.trim() || !tProduto}>
            Rodar agora
          </button>
        </div>

        {produtoEscolhido && !produtoEscolhido.tag_manychat && !produtoEscolhido.tag_manychat_turma && (
          <div className="aviso" style={{ marginTop: 10 }}>
            Este produto ainda não tem tag do ManyChat configurada, então o teste vai mexer
            só aqui na Ressoa. Configure em <b>Vendas → a regra do produto</b>.
          </div>
        )}

        {resultado && (
          <div style={{
            marginTop: 14, padding: "14px 16px", borderRadius: 8,
            border: "1px solid var(--borda)",
          }}>
            {resultado.ok ? (
              <>
                <b>Rodou.</b>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.8 }}>
                  <li>Contato: {resultado.contato?.como}</li>
                  <li>Produto reconhecido: <b>{resultado.resultado?.produto ?? "não reconhecido"}</b></li>
                  <li>Lista aqui: {resultado.resultado?.lista ? "entrou" : "nenhuma configurada"}</li>
                  <li>Turma aqui: {resultado.resultado?.turma ?? "nenhuma"}</li>
                  <li>ManyChat: {resultado.resultado?.manychat
                        ? <b>{resultado.resultado.manychat}</b>
                        : "nenhuma tag configurada"}</li>
                </ul>
                {resultado.resultado?.manychat && (
                  <div className="sub" style={{ marginTop: 10 }}>
                    Procure a pessoa acima pelo WhatsApp para conferir as tags dela lá.
                  </div>
                )}
              </>
            ) : (
              <><b>Não rodou.</b> {resultado.erro}</>
            )}
          </div>
        )}
      </div>

      {/* ---------------- tags ---------------- */}
      <div className="caixa">
        <h2>Tags no ManyChat <span className="contagem">({tags.length})</span>
          <Ajuda>São as tags da sua conta lá, não as daqui. É por elas que os fluxos do ManyChat disparam.</Ajuda>
        </h2>

        <div className="linha" style={{ marginTop: 12 }}>
          <input value={novaTag} placeholder="nome da tag nova"
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criarTag()} />
          <button className="primario" style={{ flex: "0 0 auto" }}
            onClick={criarTag} disabled={!novaTag.trim()}>Criar tag</button>
        </div>

        <input value={filtro} placeholder="filtrar a lista…" style={{ marginTop: 12 }}
          onChange={(e) => setFiltro(e.target.value)} />

        <div style={{ marginTop: 12, maxHeight: 320, overflowY: "auto" }}>
          {carregando && <div className="sub">carregando…</div>}
          {!carregando && !tagsFiltradas.length && (
            <div className="sub">nenhuma tag {filtro.trim() ? "com esse texto" : ""}.</div>
          )}
          {tagsFiltradas.map((t) => (
            <span key={t.id} className="etiqueta"
              style={{ marginRight: 6, marginBottom: 6, display: "inline-block", cursor: "pointer" }}
              title="usar esta tag acima"
              onClick={() => setTagEscolhida(t.name)}>
              {t.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
