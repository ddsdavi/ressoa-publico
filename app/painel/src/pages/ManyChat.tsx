import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Ajuda from "../components/Ajuda";

// Banco de testes do ManyChat.
//
// A tela anterior tinha três caixas soltas — procurar, trazer da Ressoa,
// rodar a regra — e nenhuma delas era o que se precisa fazer. O que se
// precisa é percorrer o caminho inteiro de uma vez, com um número:
//
//   formata o telefone → procura no ManyChat → achou? aplica a tag
//                                            → não achou? cria e aplica
//
// É o mesmo caminho da automação quando alguém compra. Aqui ele roda a
// pedido, e cada passo aparece — para dar para ver ONDE parou quando
// parar, em vez de só descobrir que não funcionou.

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
type Assinante = { id: number; nome: string; status: string; whatsapp: string; tags: string[] };
type NaRessoa = {
  lead_id: string; nome: string | null; whatsapp: string | null;
  manychat_id: string | null; tags: string[]; listas: string[];
};
type Produto = {
  id: number; apelido: string; tag_manychat: string | null; tag_manychat_turma: boolean;
};
type Passo = { texto: string; estado: "ok" | "erro" | "info" };

export default function ManyChat() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [erroGeral, setErroGeral] = useState("");

  // o fluxo
  const [fone, setFone] = useState("");
  const [nome, setNome] = useState("");
  const [alvo, setAlvo] = useState<"produto" | "tag">("produto");
  const [produto, setProduto] = useState("");
  const [tagAvulsa, setTagAvulsa] = useState("");
  const [passos, setPassos] = useState<Passo[]>([]);
  const [rodando, setRodando] = useState(false);

  // quem é essa pessoa, dos dois lados
  const [assinante, setAssinante] = useState<Assinante | null>(null);
  const [naRessoa, setNaRessoa] = useState<NaRessoa | null>(null);
  const [procurou, setProcurou] = useState(false);

  // tags da conta
  const [novaTag, setNovaTag] = useState("");
  const [filtro, setFiltro] = useState("");
  const [verTags, setVerTags] = useState(false);

  async function carregarTags() {
    const d = await chamar({ acao: "tags" });
    if (d.ok) { setTags(d.tags ?? []); setErroGeral(""); }
    else setErroGeral("Não deu para ler as tags do ManyChat. Confira a chave em Configurações → ManyChat.");
  }

  useEffect(() => {
    carregarTags();
    supabase.from("hotmart_produtos")
      .select("id,apelido,tag_manychat,tag_manychat_turma").eq("ativo", true).order("apelido")
      .then(({ data }) => setProdutos((data as Produto[]) ?? []));
  }, []);

  // Procurar dos DOIS lados de uma vez. Antes eram duas caixas separadas, e
  // a pergunta "quem é essa pessoa" tinha duas respostas em lugares
  // diferentes da tela.
  async function procurar(numero = fone) {
    if (!numero.trim()) return null;
    const [mc, { data: rs }] = await Promise.all([
      chamar({ acao: "procurar", whatsapp: numero }),
      supabase.rpc("lead_por_whatsapp", { p_fone: numero }),
    ]);
    setAssinante(mc.existe ? mc.assinante : null);
    setNaRessoa((rs as NaRessoa) ?? null);
    setProcurou(true);
    return mc;
  }

  const tagDoProduto = () => {
    const p = produtos.find((x) => String(x.id) === produto);
    return p?.tag_manychat ?? "";
  };

  async function rodarFluxo() {
    const registro: Passo[] = [];
    const anota = (texto: string, estado: Passo["estado"] = "ok") => {
      registro.push({ texto, estado });
      setPassos([...registro]);
    };

    setRodando(true);
    setPassos([]);

    // 1. quem é aqui
    const mc = await procurar();
    const { data: rs } = await supabase.rpc("lead_por_whatsapp", { p_fone: fone });
    anota(rs ? `Na Ressoa: ${(rs as NaRessoa).nome ?? "(sem nome)"}`
             : "Na Ressoa: não existe ainda", rs ? "ok" : "info");

    if (!mc || mc.erro) {
      anota(mc?.erro ?? "não deu para consultar o ManyChat", "erro");
      setRodando(false); return;
    }
    anota(`Telefone acertado para ${mc.formatado}`, "info");

    // 2. rodar
    if (alvo === "produto") {
      if (!produto) { anota("escolha o produto", "erro"); setRodando(false); return; }
      const { data, error } = await supabase.rpc("testar_regra_produto", {
        p_nome: nome.trim() || null, p_whatsapp: fone.trim(),
        p_email: null, p_produto_id: Number(produto),
      });
      if (error) { anota(error.message, "erro"); setRodando(false); return; }
      const d = data as Record<string, any>;
      if (!d?.ok) { anota(d?.erro ?? "não rodou", "erro"); setRodando(false); return; }
      anota(`Contato: ${d.como}`);
      anota(d.resultado?.lista ? "Entrou na lista do produto" : "Produto sem lista configurada",
            d.resultado?.lista ? "ok" : "info");
      anota(d.resultado?.turma ? `Tag de turma aqui: ${d.resultado.turma}` : "Sem tag de turma",
            d.resultado?.turma ? "ok" : "info");
      anota(d.resultado?.manychat
              ? `Mandado ao ManyChat: ${d.resultado.manychat}`
              : "Produto sem tag do ManyChat — configure em Vendas",
            d.resultado?.manychat ? "ok" : "erro");
    } else {
      if (!tagAvulsa) { anota("escolha a tag", "erro"); setRodando(false); return; }
      const d = await chamar({ whatsapp: fone, nome, tag: tagAvulsa, criar: true });
      if (!d.ok) { anota(d.motivo ?? d.erro ?? "não deu", "erro"); setRodando(false); return; }
      anota(d.criado ? `Criado no ManyChat (assinante ${d.assinante})`
                     : `Já existia no ManyChat (assinante ${d.assinante}, achado por ${d.como})`);
      anota(`Tag ${tagAvulsa} aplicada`);
    }

    // 3. como ficou
    await new Promise((r) => setTimeout(r, 2500));   // o ManyChat leva um instante
    const fim = await procurar();
    anota(fim?.existe
      ? `Agora tem ${fim.assinante.tags.length} tag(s) no ManyChat`
      : "Ainda não aparece no ManyChat — veja o passo que falhou acima",
      fim?.existe ? "ok" : "erro");
    setRodando(false);
  }

  async function marcar(tag: string, remover: boolean) {
    if (!assinante) return;
    setRodando(true);
    await chamar(remover
      ? { acao: "desmarcar", manychat_id: String(assinante.id), tag }
      : { manychat_id: String(assinante.id), tag, criar: false });
    await new Promise((r) => setTimeout(r, 1200));
    await procurar();
    setRodando(false);
  }

  async function criarTag() {
    if (!novaTag.trim()) return;
    const d = await chamar({ acao: "criar_tag", tag: novaTag.trim() });
    setNovaTag("");
    if (d.ok) carregarTags();
    else alert(JSON.stringify(d.detalhe ?? d.erro));
  }

  const cor = (e: Passo["estado"]) =>
    e === "erro" ? "var(--perigo)" : e === "info" ? "var(--texto2)" : "var(--marca)";
  const tagsFiltradas = tags.filter((t) =>
    !filtro.trim() || t.name.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div>
      <h1>ManyChat</h1>
      <div className="sub">
        Rode o mesmo caminho da automação, com um número, e veja cada passo.
      </div>

      {erroGeral && <div className="aviso">{erroGeral}</div>}

      {/* ---------------- o fluxo ---------------- */}
      <div className="caixa">
        <h2>Rodar o fluxo
          <Ajuda>
            É o mesmo que acontece quando alguém compra: o telefone é acertado, a pessoa é
            procurada no ManyChat pelo campo do WhatsApp, e recebe a tag. Se não existir
            lá, é criada antes. Serve para conferir que o caminho funciona antes de deixar
            a automação solta.
          </Ajuda>
        </h2>

        <div className="linha" style={{ marginTop: 12 }}>
          <div style={{ flex: 2 }}>
            <label>WhatsApp
              <Ajuda>
                DDI + DDD (sem o zero) + número, tudo junto: <b>5551999990000</b>.
                Pode colar com pontuação que o sistema limpa — mas telefone fixo é
                recusado, porque fixo não tem WhatsApp.
              </Ajuda>
            </label>
            <input value={fone} placeholder="5551999990000"
              onChange={(e) => setFone(e.target.value)}
              onBlur={() => fone.trim() && procurar()}
              onKeyDown={(e) => e.key === "Enter" && procurar()} />
          </div>
          <div style={{ flex: 2 }}>
            <label>Nome
              <Ajuda>
                Usado só se a pessoa <b>não existir</b> no ManyChat e precisar ser criada.
                Para procurar, ele não é usado — a busca é sempre pelo número.
              </Ajuda>
            </label>
            <input value={nome} placeholder="Maria Silva"
              onChange={(e) => setNome(e.target.value)} />
          </div>
        </div>

        <label style={{ marginTop: 14 }}>Que tag aplicar</label>
        <div className="linha">
          <button style={{ flex: "0 0 auto" }} className={alvo === "produto" ? "primario" : ""}
            onClick={() => setAlvo("produto")}>A do produto</button>
          <button style={{ flex: "0 0 auto" }} className={alvo === "tag" ? "primario" : ""}
            onClick={() => setAlvo("tag")}>Uma tag específica</button>
        </div>

        {alvo === "produto" ? (
          <>
            <select value={produto} onChange={(e) => setProduto(e.target.value)}
              style={{ marginTop: 10 }}>
              <option value="">— escolher o produto —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.apelido}{p.tag_manychat ? ` → ${p.tag_manychat}` : " (sem tag configurada)"}
                </option>
              ))}
            </select>
            {produto && !tagDoProduto() && (
              <div className="aviso" style={{ marginTop: 8 }}>
                Este produto não tem tag do ManyChat. Configure em <b>Vendas</b>, na regra
                dele, senão o fluxo mexe só aqui dentro.
              </div>
            )}
          </>
        ) : (
          <select value={tagAvulsa} onChange={(e) => setTagAvulsa(e.target.value)}
            style={{ marginTop: 10 }}>
            <option value="">— escolher a tag —</option>
            {tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={rodarFluxo}
            disabled={rodando || !fone.trim() || (alvo === "produto" ? !produto : !tagAvulsa)}>
            {rodando ? "rodando…" : "Rodar o fluxo"}
          </button>
        </div>

        {!!passos.length && (
          <ol style={{ marginTop: 16, paddingLeft: 20, lineHeight: 2 }}>
            {passos.map((p, i) => (
              <li key={i} style={{ color: cor(p.estado) }}>
                {p.estado === "erro" ? "✕ " : p.estado === "ok" ? "✓ " : "· "}{p.texto}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ---------------- quem é essa pessoa ---------------- */}
      {procurou && (
        <div className="caixa">
          <h2>Esta pessoa</h2>

          <div style={{ display: "grid", gap: 16,
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div>
              <b>Na Ressoa</b>
              {naRessoa ? (
                <div style={{ marginTop: 6 }}>
                  <div>{naRessoa.nome || <i>sem nome</i>}</div>
                  <div className="sub" style={{ margin: "2px 0 8px" }}>{naRessoa.whatsapp}</div>
                  {naRessoa.listas.map((l) => (
                    <span key={l} className="etiqueta" style={{ marginRight: 5 }}>{l}</span>
                  ))}
                  <div style={{ marginTop: 6 }}>
                    {naRessoa.tags.slice(0, 8).map((t) => (
                      <span key={t} className="etiqueta et-roxa" style={{ marginRight: 5 }}>{t}</span>
                    ))}
                  </div>
                </div>
              ) : <div className="sub" style={{ marginTop: 6 }}>não existe aqui ainda</div>}
            </div>

            <div>
              <b>No ManyChat</b>
              {assinante ? (
                <div style={{ marginTop: 6 }}>
                  <div>{assinante.nome || <i>sem nome</i>}</div>
                  <div className="sub" style={{ margin: "2px 0 8px" }}>
                    assinante {assinante.id} · {assinante.status}
                  </div>
                  {assinante.tags.length
                    ? assinante.tags.map((t) => (
                        <span key={t} className="etiqueta et-roxa"
                          style={{ marginRight: 5, marginBottom: 5, display: "inline-block" }}>
                          {t}
                          <button title="remover esta tag lá" disabled={rodando}
                            onClick={() => marcar(t, true)}
                            style={{
                              marginLeft: 6, padding: 0, width: 15, height: 15, borderRadius: "50%",
                              border: "none", background: "rgba(0,0,0,.25)", color: "inherit",
                              cursor: "pointer", fontSize: 10, lineHeight: "13px",
                            }}>×</button>
                        </span>
                      ))
                    : <span className="sub">nenhuma tag</span>}
                </div>
              ) : <div className="sub" style={{ marginTop: 6 }}>não existe lá ainda</div>}
            </div>
          </div>

          {assinante && (
            <div className="linha" style={{ marginTop: 16 }}>
              <select value={tagAvulsa} style={{ flex: 2 }}
                onChange={(e) => setTagAvulsa(e.target.value)}>
                <option value="">— escolher a tag —</option>
                {tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button style={{ flex: "0 0 auto" }} disabled={!tagAvulsa || rodando}
                onClick={() => marcar(tagAvulsa, false)}>Aplicar</button>
              <button style={{ flex: "0 0 auto" }} disabled={!tagAvulsa || rodando}
                onClick={() => marcar(tagAvulsa, true)}>Remover</button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- tags da conta ---------------- */}
      <div className="caixa">
        <div className="linha" style={{ alignItems: "center" }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            Tags da conta <span className="contagem">({tags.length})</span>
            <Ajuda>
              São as tags do ManyChat, não as da Ressoa. É por elas que os fluxos de lá
              disparam — por isso a tag precisa existir lá antes de a automação usá-la.
            </Ajuda>
          </h2>
          <button style={{ flex: "0 0 auto" }} onClick={() => setVerTags((v) => !v)}>
            {verTags ? "esconder" : "ver a lista"}
          </button>
        </div>

        <div className="linha" style={{ marginTop: 12 }}>
          <input value={novaTag} placeholder="criar uma tag nova"
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criarTag()} />
          <button style={{ flex: "0 0 auto" }} onClick={criarTag} disabled={!novaTag.trim()}>
            Criar
          </button>
        </div>

        {verTags && (
          <>
            <input value={filtro} placeholder="filtrar…" style={{ marginTop: 12 }}
              onChange={(e) => setFiltro(e.target.value)} />
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
              {tagsFiltradas.map((t) => (
                <div key={t.id} className="sub"
                  style={{ padding: "4px 0", borderBottom: "1px solid var(--borda)" }}>
                  {t.name}
                </div>
              ))}
              {!tagsFiltradas.length && <div className="sub">nada com esse texto.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
