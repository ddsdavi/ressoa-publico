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
  const { data: sessao } = await supabase.auth.getSession();
  const r = await fetch(FUNCOES, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CHAVE,
      Authorization: `Bearer ${sessao.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados: Record<string, any> = {};
  try { dados = JSON.parse(texto); }
  catch { dados = { ok: false, erro: texto || `erro ${r.status}` }; }
  if (!r.ok && dados.ok !== false) dados.ok = false;
  return dados;
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
  const [produto, setProduto] = useState("");
  const [tagAvulsa, setTagAvulsa] = useState("");
  const [passos, setPassos] = useState<Passo[]>([]);
  const [rodando, setRodando] = useState(false);
  const [acaoContato, setAcaoContato] = useState(false);
  const [mensagemContato, setMensagemContato] = useState<Passo | null>(null);
  const [mensagemTagUsuario, setMensagemTagUsuario] = useState<Passo | null>(null);

  // quem é essa pessoa, dos dois lados
  const [assinante, setAssinante] = useState<Assinante | null>(null);
  const [naRessoa, setNaRessoa] = useState<NaRessoa | null>(null);
  const [procurou, setProcurou] = useState(false);

  // tags da conta
  const [novaTag, setNovaTag] = useState("");
  const [filtro, setFiltro] = useState("");
  const [verTags, setVerTags] = useState(false);
  const [tagEmAcao, setTagEmAcao] = useState<number | null>(null);
  const [mensagemTags, setMensagemTags] = useState<Passo | null>(null);
  const [tagParaExcluir, setTagParaExcluir] = useState<Tag | null>(null);

  async function carregarTags() {
    try {
      const d = await chamar({ acao: "tags" });
      if (d.ok) { setTags(d.tags ?? []); setErroGeral(""); }
      else setErroGeral("Não deu para ler as tags do ManyChat. Confira a chave em Configurações → ManyChat.");
    } catch {
      setErroGeral("Não deu para falar com o ManyChat. Tente novamente.");
    }
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

  async function buscarUsuario() {
    if (!fone.trim()) return;
    setAcaoContato(true);
    setMensagemContato(null);
    try {
      const d = await procurar();
      if (!d?.ok) {
        setMensagemContato({ texto: d?.erro ?? "Não deu para consultar o ManyChat.", estado: "erro" });
      } else if (d.existe) {
        setMensagemContato({ texto: "Usuário encontrado pelo WhatsApp.", estado: "ok" });
      } else {
        setMensagemContato({ texto: "Nenhum usuário encontrado com esse WhatsApp.", estado: "info" });
      }
    } catch {
      setMensagemContato({ texto: "Não deu para consultar o ManyChat.", estado: "erro" });
    } finally {
      setAcaoContato(false);
    }
  }

  async function criarUsuario() {
    if (!fone.trim() || !nome.trim()) return;
    setAcaoContato(true);
    setMensagemContato(null);
    try {
      const d = await chamar({ acao: "criar", whatsapp: fone, nome: nome.trim() });
      if (!d.ok) {
        setMensagemContato({ texto: d.erro ?? "Não deu para criar o usuário.", estado: "erro" });
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      await procurar();
      setMensagemContato({
        texto: d.criado
          ? "Usuário criado no ManyChat e ligado ao WhatsApp."
          : "Esse WhatsApp já existia no ManyChat; nenhum duplicado foi criado.",
        estado: d.criado ? "ok" : "info",
      });
    } catch {
      setMensagemContato({ texto: "Não deu para criar o usuário.", estado: "erro" });
    } finally {
      setAcaoContato(false);
    }
  }

  const produtoTemTag = () => {
    const p = produtos.find((x) => String(x.id) === produto);
    return !!(p?.tag_manychat || p?.tag_manychat_turma);
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

    // 2. rodar a regra do produto
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
    setMensagemTagUsuario(null);
    try {
      const d = await chamar(remover
        ? { acao: "desmarcar", manychat_id: String(assinante.id), tag }
        : { manychat_id: String(assinante.id), tag, criar: false });
      if (!d.ok) {
        setMensagemTagUsuario({ texto: d.erro ?? d.motivo ?? "A operação não foi concluída.", estado: "erro" });
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      await procurar();
      setMensagemTagUsuario({
        texto: remover ? `Tag “${tag}” removida desse usuário.` : `Tag “${tag}” aplicada nesse usuário.`,
        estado: "ok",
      });
    } catch {
      setMensagemTagUsuario({ texto: "Não deu para concluir a operação no ManyChat.", estado: "erro" });
    } finally {
      setRodando(false);
    }
  }

  async function criarTag() {
    if (!novaTag.trim()) return;
    setTagEmAcao(-1);
    setMensagemTags(null);
    const nomeTag = novaTag.trim();
    try {
      const d = await chamar({ acao: "criar_tag", tag: nomeTag });
      if (d.ok) {
        setNovaTag("");
        await carregarTags();
        setMensagemTags({ texto: d.mensagem ?? `Tag “${nomeTag}” criada.`, estado: "ok" });
      } else {
        setMensagemTags({ texto: d.erro ?? "Não deu para criar a tag.", estado: "erro" });
      }
    } catch {
      setMensagemTags({ texto: "Não deu para criar a tag.", estado: "erro" });
    } finally {
      setTagEmAcao(null);
    }
  }

  async function confirmarExclusaoTag() {
    const t = tagParaExcluir;
    if (!t) return;
    setTagEmAcao(t.id);
    setMensagemTags(null);
    try {
      const d = await chamar({ acao: "excluir_tag", tag_id: t.id, tag: t.name });
      if (!d.ok) {
        setMensagemTags({ texto: d.erro ?? "Não deu para excluir a tag.", estado: "erro" });
        return;
      }
      if (tagAvulsa === t.name) setTagAvulsa("");
      await carregarTags();
      if (assinante) await procurar();
      setMensagemTags({ texto: d.mensagem ?? `Tag “${t.name}” excluída.`, estado: "ok" });
      setTagParaExcluir(null);
    } catch {
      setMensagemTags({ texto: "Não deu para excluir a tag.", estado: "erro" });
    } finally {
      setTagEmAcao(null);
    }
  }

  const cor = (e: Passo["estado"]) =>
    e === "erro" ? "var(--perigo)" : e === "info" ? "var(--texto2)" : "var(--marca)";
  const tagsFiltradas = tags.filter((t) =>
    !filtro.trim() || t.name.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div>
      <h1>ManyChat</h1>
      <div className="sub">
        Gerencie pessoas e tags do ManyChat. A busca de pessoa é sempre pelo WhatsApp.
      </div>

      {erroGeral && <div className="aviso">{erroGeral}</div>}

      {/* ---------------- pessoas ---------------- */}
      <div className="caixa">
        <h2>Pessoas no ManyChat
          <Ajuda>
            A consulta usa somente o número completo do WhatsApp. O nome não participa da
            busca; ele é usado apenas quando você cria um usuário novo.
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
              onKeyDown={(e) => e.key === "Enter" && buscarUsuario()} />
          </div>
          <div style={{ flex: 2 }}>
            <label>Nome <span className="sub">(somente para criar)</span>
              <Ajuda>
                Preencha o nome e o WhatsApp para criar um usuário. Para buscar alguém,
                basta informar o WhatsApp.
              </Ajuda>
            </label>
            <input value={nome} placeholder="Maria Silva"
              onChange={(e) => setNome(e.target.value)} />
          </div>
        </div>

        <div className="linha" style={{ marginTop: 16 }}>
          <button className="primario" style={{ flex: "0 0 auto" }}
            onClick={buscarUsuario} disabled={acaoContato || !fone.trim()}>
            {acaoContato ? "aguarde…" : "Buscar por WhatsApp"}
          </button>
          <button style={{ flex: "0 0 auto" }} onClick={criarUsuario}
            disabled={acaoContato || !fone.trim() || !nome.trim()}>
            Criar usuário
          </button>
        </div>

        {mensagemContato && (
          <div className="aviso" style={{ marginTop: 14, color: cor(mensagemContato.estado) }}>
            {mensagemContato.texto}
          </div>
        )}

        {procurou && (
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--borda)" }}>
            <h3 style={{ margin: "0 0 12px" }}>Resultado da busca</h3>
          <div style={{ display: "grid", gap: 16,
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div>
              <b>Na Ressoa</b>
              {naRessoa ? (
                <div style={{ marginTop: 6 }}>
                  <div>{naRessoa.nome || <i>sem nome</i>}</div>
                  <div className="sub" style={{ marginTop: 2 }}>{naRessoa.whatsapp}</div>
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
                </div>
              ) : <div className="sub" style={{ marginTop: 6 }}>não existe lá ainda</div>}
            </div>
          </div>
          </div>
        )}
      </div>

      {/* ---------------- automação ---------------- */}
      <div className="caixa">
        <h2>Testar automação de produto
          <Ajuda>
            Usa o WhatsApp informado acima e percorre o mesmo caminho de uma compra,
            inclusive lista, turma e tag configurada no produto.
          </Ajuda>
        </h2>
        <div className="sub" style={{ marginBottom: 12 }}>
          WhatsApp usado: <b>{fone.trim() || "informe o número no bloco Pessoas"}</b>
        </div>

        <select value={produto} onChange={(e) => setProduto(e.target.value)}>
          <option value="">— escolher o produto —</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.apelido}{p.tag_manychat
                ? ` → ${p.tag_manychat}`
                : p.tag_manychat_turma
                  ? " → tag semanal da turma"
                  : " (sem tag configurada)"}
            </option>
          ))}
        </select>
        {produto && !produtoTemTag() && (
          <div className="aviso" style={{ marginTop: 8 }}>
            Este produto não tem tag do ManyChat. Configure em <b>Vendas</b>, na regra dele.
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={rodarFluxo}
            disabled={rodando || !fone.trim() || !produto}>
            {rodando ? "executando…" : "Testar regra do produto"}
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

      {/* ---------------- todas as tags ---------------- */}
      <div className="caixa">
        <h2 style={{ marginTop: 0 }}>Tags</h2>

        <div>
          <h3 style={{ margin: "0 0 6px" }}>Tags do usuário encontrado</h3>
          {!procurou && (
            <div className="sub">Busque um usuário pelo WhatsApp para aplicar ou remover tags.</div>
          )}
          {procurou && !assinante && (
            <div className="sub">Esse WhatsApp ainda não possui usuário no ManyChat.</div>
          )}
          {assinante && (
            <>
              <div className="sub" style={{ marginBottom: 10 }}>
                <b>{assinante.nome || "sem nome"}</b> · {fone}
              </div>
              <div style={{ marginBottom: 10 }}>
                {assinante.tags.length
                  ? assinante.tags.map((t) => (
                      <span key={t} className="etiqueta et-roxa"
                        style={{ marginRight: 5, marginBottom: 5, display: "inline-block" }}>
                        {t}
                        <button title="remover esta tag" disabled={rodando}
                          onClick={() => marcar(t, true)}
                          style={{
                            marginLeft: 6, padding: 0, width: 15, height: 15, borderRadius: "50%",
                            border: "none", background: "rgba(0,0,0,.25)", color: "inherit",
                            cursor: "pointer", fontSize: 10, lineHeight: "13px",
                          }}>×</button>
                      </span>
                    ))
                  : <span className="sub">Esse usuário ainda não possui tags.</span>}
              </div>
              <div className="linha">
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
            </>
          )}
          {mensagemTagUsuario && (
            <div className="aviso" style={{ marginTop: 12, color: cor(mensagemTagUsuario.estado) }}>
              {mensagemTagUsuario.texto}
            </div>
          )}
        </div>

        <div style={{ margin: "22px 0 18px", borderTop: "1px solid var(--borda)" }} />

        <div className="linha" style={{ alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            Tags da conta <span className="contagem">({tags.length})</span>
            <Ajuda>
              São as tags do ManyChat, não as da Ressoa. É por elas que os fluxos de lá
              disparam — por isso a tag precisa existir lá antes de a automação usá-la.
            </Ajuda>
          </h3>
          <button style={{ flex: "0 0 auto" }} onClick={() => setVerTags((v) => !v)}>
            {verTags ? "Esconder lista" : "Gerenciar tags"}
          </button>
        </div>

        <div className="sub" style={{ marginTop: 8 }}>
          Crie uma tag nova ou abra a lista para localizar e excluir uma tag da conta.
        </div>

        <div className="linha" style={{ marginTop: 12 }}>
          <input value={novaTag} placeholder="criar uma tag nova"
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criarTag()} />
          <button style={{ flex: "0 0 auto" }} onClick={criarTag}
            disabled={!novaTag.trim() || tagEmAcao !== null}>
            {tagEmAcao === -1 ? "Criando…" : "Criar tag"}
          </button>
        </div>

        {mensagemTags && (
          <div className="aviso" style={{ marginTop: 12, color: cor(mensagemTags.estado) }}>
            {mensagemTags.texto}
          </div>
        )}

        {tagParaExcluir && (
          <div className="aviso" style={{ marginTop: 12, borderColor: "var(--perigo)" }}>
            <b>Excluir a tag “{tagParaExcluir.name}”?</b>
            <div className="sub" style={{ marginTop: 5 }}>
              Ela será removida da conta e de todos os usuários. Esta ação não pode ser desfeita.
            </div>
            <div className="linha" style={{ marginTop: 10 }}>
              <button style={{ flex: "0 0 auto" }} disabled={tagEmAcao !== null}
                onClick={() => setTagParaExcluir(null)}>Cancelar</button>
              <button className="perigo" style={{ flex: "0 0 auto" }}
                disabled={tagEmAcao !== null} onClick={confirmarExclusaoTag}>
                {tagEmAcao === tagParaExcluir.id ? "Excluindo…" : "Confirmar exclusão"}
              </button>
            </div>
          </div>
        )}

        {verTags && (
          <>
            <input value={filtro} placeholder="buscar tag pelo nome…" style={{ marginTop: 12 }}
              onChange={(e) => setFiltro(e.target.value)} />
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
              {tagsFiltradas.map((t) => (
                <div key={t.id} className="sub"
                  style={{
                    padding: "7px 0", borderBottom: "1px solid var(--borda)",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                  <span style={{ flex: 1 }}>{t.name}</span>
                  <button className="perigo" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                    disabled={tagEmAcao !== null} onClick={() => setTagParaExcluir(t)}>
                    {tagEmAcao === t.id ? "Excluindo…" : "Excluir"}
                  </button>
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
