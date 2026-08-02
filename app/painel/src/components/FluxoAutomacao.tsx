import { useEffect, useState } from "react";

// Quadro visual da automação — a mesma leitura do ActiveCampaign: o gatilho
// no topo, os passos descendo ligados por uma linha, e o "+" entre eles.
//
// Só aparece aqui o que o motor do banco realmente executa. Gatilho bonito
// que não dispara nada é pior que gatilho nenhum: a pessoa monta o fluxo,
// ativa, e fica esperando um e-mail que nunca sai. O que ainda não existe
// aparece apagado e dizendo que não está disponível.

export type Passo = { ordem: number; tipo: string; config: Record<string, any> };
export type Gatilho = Record<string, any> | null;

type Item = {
  id: string; rotulo: string; icone: string; categoria: string;
  disponivel: boolean; ajuda?: string;
};

const GATILHOS: Item[] = [
  { id: "lista_inscrita", rotulo: "Inscreve-se em uma lista", icone: "📋", categoria: "Listas e tags", disponivel: true },
  { id: "lista_descadastrada", rotulo: "Descadastra-se de uma lista", icone: "📤", categoria: "Listas e tags", disponivel: true },
  { id: "tag_adicionada", rotulo: "Tag é adicionada", icone: "🏷", categoria: "Listas e tags", disponivel: true },
  { id: "lead_criado", rotulo: "Contato é criado", icone: "👤", categoria: "Listas e tags", disponivel: true },
  { id: "email_aberto", rotulo: "Abre um e-mail", icone: "👁", categoria: "Comportamento", disponivel: true },
  { id: "email_clicado", rotulo: "Clica em um link", icone: "🔗", categoria: "Comportamento", disponivel: true },
  { id: "compra_realizada", rotulo: "Faz uma compra", icone: "💰", categoria: "Vendas", disponivel: true,
    ajuda: "Depende de importar as vendas. Enquanto a tabela de compras estiver vazia, não dispara." },
  { id: "carrinho_abandonado", rotulo: "Abandona o carrinho", icone: "🛒", categoria: "Vendas", disponivel: true,
    ajuda: "A Hotmart avisa quando alguém sai do checkout sem concluir. O e-mail pode citar o produto com %EVENTO.produto%." },
  { id: "boleto_gerado", rotulo: "Gera boleto e não paga", icone: "🧾", categoria: "Vendas", disponivel: true,
    ajuda: "Boleto impresso é intenção declarada. Vale um lembrete antes do vencimento." },
  { id: "pagamento_atrasado", rotulo: "Pagamento atrasa", icone: "⏳", categoria: "Vendas", disponivel: true,
    ajuda: "Assinatura ou parcela em atraso." },
  { id: "pagamento_expirou", rotulo: "Pagamento expira", icone: "❌", categoria: "Vendas", disponivel: true,
    ajuda: "O prazo passou e a compra caiu. Última chance de recuperar." },
  { id: "data_do_contato", rotulo: "Chega uma data do contato", icone: "🎂", categoria: "Datas", disponivel: true,
    ajuda: "Aniversário, data da compra, data da consulta — qualquer campo de data. Conferido uma vez por dia, de madrugada." },
];

const ACOES: Item[] = [
  { id: "enviar_email", rotulo: "Envia um e-mail", icone: "✉", categoria: "E-mail", disponivel: true },
  { id: "esperar", rotulo: "Espera", icone: "⏱", categoria: "Fluxo", disponivel: true },
  { id: "aplicar_tag", rotulo: "Adiciona uma tag", icone: "🏷", categoria: "Contato", disponivel: true },
  { id: "remover_tag", rotulo: "Remove uma tag", icone: "🏷", categoria: "Contato", disponivel: true },
  { id: "inscrever_lista", rotulo: "Inscreve em uma lista", icone: "📋", categoria: "Contato", disponivel: true },
  { id: "desinscrever_lista", rotulo: "Descadastra de uma lista", icone: "📤", categoria: "Contato", disponivel: true },
  { id: "google_sheets", rotulo: "Google Sheets", icone: "📗", categoria: "Integrações", disponivel: true,
    ajuda: "Manda o contato para o seu n8n, que escreve a linha na planilha." },
  { id: "google_drive", rotulo: "Google Drive", icone: "📁", categoria: "Integrações", disponivel: true,
    ajuda: "Manda o contato para o seu n8n, que cria ou atualiza o arquivo." },
  { id: "webhook", rotulo: "Webhook (qualquer sistema)", icone: "⚡", categoria: "Integrações", disponivel: true },
  { id: "manychat_tag", rotulo: "Marcar no ManyChat", icone: "💬", categoria: "Integrações", disponivel: true,
    ajuda: "Procura a pessoa no ManyChat pelo WhatsApp, cria se não existir, e aplica a tag. É a tag que dispara a mensagem de lá." },
  { id: "condicao", rotulo: "Se / então", icone: "🔀", categoria: "Fluxo", disponivel: true,
    ajuda: "Manda quem atende a condição por um caminho e o resto por outro." },
];

const CONDICOES: [string, string][] = [
  ["tem_tag", "Tem a tag"],
  ["na_lista", "Está ativo na lista"],
  ["abriu_email", "Abriu algum e-mail nos últimos N dias"],
  ["clicou_email", "Clicou em algum link nos últimos N dias"],
  ["comprou", "Já comprou"],
  ["tem_whatsapp", "Tem WhatsApp cadastrado"],
  ["nao_suprimido", "Não está bloqueado"],
];

const DURACOES: [string, string][] = [
  ["15 minutes", "15 minutos"], ["1 hour", "1 hora"], ["4 hours", "4 horas"],
  ["1 day", "1 dia"], ["2 days", "2 dias"], ["7 days", "7 dias"],
];

type Ref = {
  listas: { lista_id: number; nome: string }[];
  tags: { tag_id: number; nome: string }[];
  mensagens: { mensagem_id: string; nome: string; subject: string }[];
  camposData?: string[];
};

// ---------- janela de escolha, no formato do AC ----------
function Seletor({ titulo, itens, onEscolher, onFechar }: {
  titulo: string; itens: Item[];
  onEscolher: (id: string) => void; onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("todas");
  const categorias = ["todas", ...new Set(itens.map((i) => i.categoria))];
  const filtrados = itens.filter((i) =>
    (cat === "todas" || i.categoria === cat) &&
    (!busca.trim() || i.rotulo.toLowerCase().includes(busca.toLowerCase())));

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300, background: "rgba(20,16,30,.55)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onFechar}>
      <div className="caixa" style={{ width: 760, maxWidth: "100%", maxHeight: "84vh", margin: 0, display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="linha" style={{ alignItems: "center" }}>
          <h2 style={{ margin: 0, flex: 1 }}>{titulo}</h2>
          <input style={{ flex: "0 0 220px" }} placeholder="Pesquisar…" value={busca}
            onChange={(e) => setBusca(e.target.value)} />
          <button style={{ flex: "0 0 auto" }} onClick={onFechar}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 14, minHeight: 0, flex: 1 }}>
          <div style={{ flex: "0 0 170px", borderRight: "1px solid var(--borda)", paddingRight: 12 }}>
            {categorias.map((c) => (
              <div key={c} onClick={() => setCat(c)}
                style={{
                  padding: "7px 8px", borderRadius: 6, cursor: "pointer", lineHeight: 1.35,
                  fontSize: "calc(13px * var(--escala-texto))",
                  borderLeft: `3px solid ${cat === c ? "var(--marca)" : "transparent"}`,
                  background: cat === c ? "rgba(107,78,168,.09)" : "transparent",
                  color: cat === c ? "var(--texto)" : "var(--texto2)",
                }}>
                {c === "todas" ? "Visualizar tudo" : c}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 12,
                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", alignContent: "start" }}>
            {filtrados.map((i) => (
              <div key={i.id} title={i.ajuda ?? i.rotulo}
                onClick={() => i.disponivel && onEscolher(i.id)}
                style={{
                  textAlign: "center", padding: "16px 8px", borderRadius: 10,
                  border: "1px solid var(--borda)",
                  cursor: i.disponivel ? "pointer" : "not-allowed",
                  opacity: i.disponivel ? 1 : 0.45,
                }}>
                <div style={{
                  width: 46, height: 46, margin: "0 auto 8px", borderRadius: "50%",
                  background: "rgba(107,78,168,.12)", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 21,
                }}>{i.icone}</div>
                <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", lineHeight: 1.35 }}>
                  {i.rotulo}
                </div>
                {!i.disponivel && (
                  <div style={{ fontSize: "calc(11px * var(--escala-texto))", color: "var(--texto2)", marginTop: 4 }}>
                    ainda não
                  </div>
                )}
              </div>
            ))}
            {!filtrados.length && <div className="sub">nada com esse nome</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Colocar gente dentro da automação sem esperar o gatilho. Serve para
// testar com uma pessoa e para reprocessar quem ficou de fora.
function PainelAdicionar({ onFechar, onAdicionar, listas, tags }: {
  onFechar: () => void;
  onAdicionar: (alvo: { emails?: string; lista?: number; tag?: number }) => Promise<void>;
  listas: { lista_id: number; nome: string }[];
  tags: { tag_id: number; nome: string }[];
}) {
  const [modo, setModo] = useState<"emails" | "lista" | "tag">("emails");
  const [emails, setEmails] = useState("");
  const [lista, setLista] = useState("");
  const [tag, setTag] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    await onAdicionar(
      modo === "emails" ? { emails }
        : modo === "lista" ? { lista: Number(lista) }
          : { tag: Number(tag) });
    setOcupado(false);
    onFechar();
  }

  return (
    <div className="gaveta" style={{ width: 440 }}>
      <button className="fechar" onClick={onFechar}>✕</button>
      <h2>Adicionar contatos à automação</h2>
      <div className="sub">
        Eles entram no primeiro passo agora, sem esperar o gatilho. Quem já está
        dentro não entra de novo.
      </div>

      <label>Como você quer escolher</label>
      <select value={modo} onChange={(e) => setModo(e.target.value as never)}>
        <option value="emails">Contatos específicos (para testar)</option>
        <option value="lista">Todos os ativos de uma lista</option>
        <option value="tag">Todos que têm uma tag</option>
      </select>

      {modo === "emails" && (
        <>
          <label>E-mails, um por linha</label>
          <textarea rows={7} value={emails} onChange={(e) => setEmails(e.target.value)}
            placeholder={"fulana@email.com\nbeltrano@email.com"} />
        </>
      )}
      {modo === "lista" && (
        <>
          <label>Lista</label>
          <select value={lista} onChange={(e) => setLista(e.target.value)}>
            <option value="">— escolher —</option>
            {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
          </select>
        </>
      )}
      {modo === "tag" && (
        <>
          <label>Tag</label>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">— escolher —</option>
            {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
          </select>
        </>
      )}

      <div className="aviso" style={{ marginTop: 12 }}>
        Se a automação manda e-mail, esses contatos vão <b>receber de verdade</b>.
        Para testar sem risco, comece por um endereço só.
      </div>

      <div className="linha" style={{ marginTop: 16 }}>
        <button className="primario" disabled={ocupado} onClick={confirmar}>
          {ocupado ? "Adicionando…" : "Adicionar"}
        </button>
        <button onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  );
}

export default function FluxoAutomacao({
  nome, gatilho, passos, ativa, execucoes, ref: refs, novo,
  onMudar, onSalvar, onFechar, onVerContatos, onAdicionarContatos,
}: {
  nome: string; gatilho: Gatilho; passos: Passo[]; ativa: boolean;
  execucoes: number; ref: Ref; novo: boolean;
  onMudar: (p: { nome?: string; gatilho?: Gatilho; passos?: Passo[]; ativa?: boolean }) => void;
  onSalvar: () => void; onFechar: () => void; onVerContatos: () => void;
  onAdicionarContatos: (alvo: { emails?: string; lista?: number; tag?: number }) => Promise<void>;
}) {
  const [seletor, setSeletor] = useState<null | { tipo: "gatilho" } | { tipo: "acao"; posicao: number }>(null);
  const [editando, setEditando] = useState<number | "gatilho" | null>(null);
  const [zoom, setZoom] = useState(100);

  // As tags que existem NA CONTA DO MANYCHAT. São elas que disparam os
  // fluxos de lá — saber se a escolhida existe é a diferença entre montar
  // um fluxo que funciona e um que fica marcando gente com uma tag que
  // ninguém escuta.
  const [tagsMC, setTagsMC] = useState<string[]>([]);
  const [carregandoMC, setCarregandoMC] = useState(false);
  const [criandoMC, setCriandoMC] = useState<string | null>(null);

  const chamarMC = (corpo: Record<string, unknown>) =>
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manychat`, {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" },
      body: JSON.stringify(corpo),
    }).then((r) => r.json()).catch(() => ({ ok: false }));

  async function carregarTagsMC() {
    setCarregandoMC(true);
    const d = await chamarMC({ acao: "tags" });
    setTagsMC(((d.tags ?? []) as { name: string }[]).map((t) => t.name));
    setCarregandoMC(false);
  }

  // só consulta quando um passo de ManyChat está aberto: a conta tem
  // centenas de tags, e não faz sentido buscar isso ao abrir qualquer fluxo
  useEffect(() => {
    if (typeof editando === "number" && passos[editando]?.tipo === "manychat_tag"
        && !tagsMC.length && !carregandoMC) {
      carregarTagsMC();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);

  async function criarTagMC(nome: string) {
    setCriandoMC(nome);
    const d = await chamarMC({ acao: "criar_tag", tag: nome });
    setCriandoMC(null);
    if (d.ok) await carregarTagsMC();
    else alert("Não deu para criar: " + JSON.stringify(d.detalhe ?? d.erro ?? d));
  }
  const [adicionando, setAdicionando] = useState(false);

  const mapL = Object.fromEntries(refs.listas.map((x) => [x.lista_id, x.nome]));
  const mapT = Object.fromEntries(refs.tags.map((x) => [x.tag_id, x.nome]));

  function descreverGatilho(): string {
    if (!gatilho?.tipo) return "Escolha o que inicia esta automação";
    if (gatilho.tipo === "lista_inscrita")
      return gatilho.lista_id
        ? `Contato com inscrição na lista ${mapL[gatilho.lista_id] ?? gatilho.lista_id}`
        : "Contato se inscreve numa lista — falta escolher qual";
    if (gatilho.tipo === "tag_adicionada")
      return gatilho.tag_id
        ? `Contato recebe a tag ${mapT[gatilho.tag_id] ?? gatilho.tag_id}`
        : "Contato recebe uma tag — falta escolher qual";
    if (gatilho.tipo === "lista_descadastrada")
      return gatilho.lista_id
        ? `Contato se descadastra da lista ${mapL[gatilho.lista_id] ?? gatilho.lista_id}`
        : "Contato se descadastra de qualquer lista";
    if (gatilho.tipo === "lead_criado") return "Um contato novo é criado";
    if (gatilho.tipo === "email_aberto") return "Contato abre um e-mail";
    if (gatilho.tipo === "email_clicado") return "Contato clica num link do e-mail";
    if (gatilho.tipo === "compra_realizada")
      return gatilho.produto ? `Contato compra "${gatilho.produto}"` : "Contato faz uma compra";
    return String(gatilho.tipo);
  }

  function descreverPasso(p: Passo): string {
    const c = p.config ?? {};
    switch (p.tipo) {
      case "enviar_email": {
        const m = refs.mensagens.find((x) => x.mensagem_id === c.mensagem_id);
        return m ? `Envia o e-mail ${m.nome}` : "Envia um e-mail — falta escolher qual";
      }
      case "esperar":
        return c.duracao
          ? `Espera ${DURACOES.find(([v]) => v === c.duracao)?.[1] ?? c.duracao}`
          : "Espera — falta escolher quanto tempo";
      case "aplicar_tag": return c.tag_id ? `Adiciona a tag ${mapT[c.tag_id] ?? c.tag_id}` : "Adiciona uma tag — falta escolher";
      case "remover_tag": return c.tag_id ? `Remove a tag ${mapT[c.tag_id] ?? c.tag_id}` : "Remove uma tag — falta escolher";
      case "inscrever_lista": return c.lista_id ? `Inscreve na lista ${mapL[c.lista_id] ?? c.lista_id}` : "Inscreve numa lista — falta escolher";
      case "desinscrever_lista": return c.lista_id ? `Descadastra da lista ${mapL[c.lista_id] ?? c.lista_id}` : "Descadastra de uma lista — falta escolher";
      case "condicao": {
        const cd = c.condicao ?? {};
        const rot = CONDICOES.find(([v]) => v === cd.tipo)?.[1] ?? "condição";
        const alvo = cd.tag_id ? ` "${mapT[cd.tag_id] ?? cd.tag_id}"`
          : cd.lista_id ? ` "${mapL[cd.lista_id] ?? cd.lista_id}"`
            : cd.dias ? ` (${cd.dias} dias)` : "";
        return cd.tipo ? `Se ${rot.toLowerCase()}${alvo}` : "Se / então — falta escolher a condição";
      }
      case "webhook": return c.url ? `Envia os dados para ${c.url}` : "Chama um webhook — falta a URL";
      case "google_sheets": return c.url ? "Escreve uma linha no Google Sheets" : "Google Sheets — falta a URL do n8n";
      case "google_drive": return c.url ? "Envia para o Google Drive" : "Google Drive — falta a URL do n8n";
      default: return p.tipo;
    }
  }

  const completo = (p: Passo) => {
    const c = p.config ?? {};
    if (p.tipo === "enviar_email") return !!c.mensagem_id;
    if (p.tipo === "esperar") return !!c.duracao;
    if (p.tipo === "aplicar_tag" || p.tipo === "remover_tag") return !!c.tag_id;
    if (p.tipo === "inscrever_lista" || p.tipo === "desinscrever_lista") return !!c.lista_id;
    if (p.tipo === "webhook" || p.tipo === "google_sheets" || p.tipo === "google_drive") return !!c.url;
    if (p.tipo === "manychat_tag") return !!c.tag;
    if (p.tipo === "condicao") return !!c.condicao?.tipo;
    return true;
  };
  const SEM_ALVO = ["lead_criado", "email_aberto", "email_clicado",
                    "compra_realizada", "lista_descadastrada"];
  const gatilhoCompleto = !!gatilho?.tipo &&
    (SEM_ALVO.includes(gatilho.tipo) || !!gatilho.lista_id || !!gatilho.tag_id);

  const iconeDe = (tipo: string) => ACOES.find((a) => a.id === tipo)?.icone ?? "•";
  const ehGoogle = (t: string) => t === "google_sheets" || t === "google_drive";

  function inserirAcao(id: string, posicao: number) {
    const novos = [...passos];
    novos.splice(posicao, 0, { ordem: 0, tipo: id, config: {} });
    onMudar({ passos: novos.map((p, i) => ({ ...p, ordem: i + 1 })) });
    setSeletor(null);
    setEditando(posicao);
  }
  function mudarPasso(i: number, config: Record<string, any>) {
    onMudar({ passos: passos.map((p, x) => (x === i ? { ...p, config } : p)) });
  }
  function removerPasso(i: number) {
    onMudar({ passos: passos.filter((_, x) => x !== i).map((p, x) => ({ ...p, ordem: x + 1 })) });
    setEditando(null);
  }
  function mover(i: number, dir: -1 | 1) {
    const alvo = i + dir;
    if (alvo < 0 || alvo >= passos.length) return;
    const c = [...passos];
    [c[i], c[alvo]] = [c[alvo], c[i]];
    onMudar({ passos: c.map((p, x) => ({ ...p, ordem: x + 1 })) });
    setEditando(alvo);
  }

  // ⊕ entre os cartões
  const Conector = ({ posicao }: { posicao: number }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 2, height: 26, background: "var(--borda)" }} />
      <button title="inserir um passo aqui"
        onClick={() => setSeletor({ tipo: "acao", posicao })}
        style={{
          width: 30, height: 30, borderRadius: "50%", padding: 0, lineHeight: 1,
          border: "1px solid var(--borda)", background: "var(--cartao, #fff)",
          cursor: "pointer", fontSize: 17, color: "var(--marca)",
        }}>+</button>
      <div style={{ width: 2, height: 26, background: "var(--borda)" }} />
    </div>
  );

  const cartao = (ok: boolean) => ({
    width: 420, maxWidth: "100%", padding: "14px 18px", borderRadius: 10,
    border: `1px solid ${ok ? "var(--borda)" : "#d8a13a"}`,
    background: "var(--cartao, #fff)", cursor: "pointer",
    display: "flex", gap: 12, alignItems: "center", textAlign: "left" as const,
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column",
      background: "var(--fundo)", overflow: "hidden",
    }}>
      {/* barra de cima */}
      <div style={{
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        padding: "10px 16px", borderBottom: "1px solid var(--borda)", background: "var(--cartao, #fff)",
      }}>
        <button onClick={onFechar} style={{ flex: "0 0 auto" }}>← Automações</button>
        <input value={nome} placeholder="Nome da automação"
          onChange={(e) => onMudar({ nome: e.target.value })}
          style={{ flex: "1 1 220px", minWidth: 160, maxWidth: 380, fontWeight: 700 }} />
        <button style={{ flex: "0 0 auto" }} onClick={() => setAdicionando(true)}>
          + Adicionar contatos
        </button>
        {execucoes > 0 && (
          <button style={{ flex: "0 0 auto" }} onClick={onVerContatos}>
            Ver contatos ({execucoes})
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", border: "1px solid var(--borda)",
                        borderRadius: 8, overflow: "hidden", flex: "0 0 auto" }}>
            <button onClick={() => onMudar({ ativa: true })}
              style={{ border: 0, borderRadius: 0, whiteSpace: "nowrap",
                       background: ativa ? "var(--ac-verde, #157347)" : "transparent",
                       color: ativa ? "#fff" : "var(--texto2)" }}>
              ● Ativa
            </button>
            <button onClick={() => onMudar({ ativa: false })}
              style={{ border: 0, borderRadius: 0, whiteSpace: "nowrap",
                       background: !ativa ? "var(--marca)" : "transparent",
                       color: !ativa ? "#fff" : "var(--texto2)" }}>
              ● Inativa
            </button>
          </div>
          <button className="primario" onClick={onSalvar}>Salvar</button>
        </div>
      </div>

      {novo && (
        <div className="aviso" style={{ margin: "12px 16px 0" }}>
          Automação nova nasce <b>inativa</b>. Só passa a disparar quando você marcar Ativa e salvar.
        </div>
      )}

      {/* o quadro */}
      <div style={{ flex: 1, overflow: "auto", padding: "34px 16px 80px",
                    backgroundImage: "radial-gradient(var(--borda) 1px, transparent 1px)",
                    backgroundSize: "22px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                      zoom: `${zoom}%` }}>
          {/* gatilho */}
          <div style={cartao(gatilhoCompleto)} onClick={() => setSeletor({ tipo: "gatilho" })}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%", flex: "0 0 auto",
              background: "rgba(107,78,168,.12)", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 18,
            }}>{GATILHOS.find((g) => g.id === gatilho?.tipo)?.icone ?? "▶"}</div>
            <div>
              <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                Inicie a automação quando
              </div>
              <b style={{ fontSize: "calc(14px * var(--escala-texto))" }}>{descreverGatilho()}</b>
            </div>
          </div>
          {gatilho?.tipo && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setEditando("gatilho")}>ajustar o gatilho</button>
            </div>
          )}

          <Conector posicao={0} />

          {/* passos */}
          {passos.map((p, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={cartao(completo(p))} onClick={() => setEditando(i)}>
                <div style={{
                  width: 38, height: 38, borderRadius: "50%", flex: "0 0 auto",
                  background: "rgba(107,78,168,.12)", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 18,
                }}>{iconeDe(p.tipo)}</div>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: "calc(14px * var(--escala-texto))" }}>{descreverPasso(p)}</b>
                  {!completo(p) && (
                    <div style={{ color: "#a4761c", fontSize: "calc(12px * var(--escala-texto))" }}>
                      falta configurar
                    </div>
                  )}
                </div>
                <span style={{ color: "var(--texto2)", fontSize: "calc(12px * var(--escala-texto))" }}>{i + 1}</span>
              </div>
              <Conector posicao={i + 1} />
            </div>
          ))}

          <div style={{ color: "var(--texto2)", fontSize: "calc(13px * var(--escala-texto))" }}>
            ⃠ A automação é encerrada
          </div>
        </div>
      </div>

      {/* zoom */}
      <div style={{
        position: "absolute", left: 16, bottom: 16, display: "flex", gap: 6, alignItems: "center",
        background: "var(--cartao, #fff)", border: "1px solid var(--borda)", borderRadius: 8, padding: 4,
      }}>
        <button style={{ padding: "2px 9px" }} onClick={() => setZoom((z) => Math.max(50, z - 10))}>−</button>
        <span style={{ fontSize: "calc(12px * var(--escala-texto))", minWidth: 40, textAlign: "center" }}>{zoom}%</span>
        <button style={{ padding: "2px 9px" }} onClick={() => setZoom((z) => Math.min(150, z + 10))}>+</button>
      </div>

      {/* janelas de escolha */}
      {seletor?.tipo === "gatilho" && (
        <Seletor titulo="Selecione o que inicia a automação" itens={GATILHOS}
          onFechar={() => setSeletor(null)}
          onEscolher={(id) => { onMudar({ gatilho: { tipo: id } }); setSeletor(null); setEditando("gatilho"); }} />
      )}
      {seletor?.tipo === "acao" && (
        <Seletor titulo="Selecione a ação" itens={ACOES}
          onFechar={() => setSeletor(null)}
          onEscolher={(id) => inserirAcao(id, (seletor as { posicao: number }).posicao)} />
      )}

      {/* painel lateral de configuração */}
      {editando !== null && (
        <div className="gaveta" style={{ width: 420 }}>
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>

          {editando === "gatilho" ? (
            <>
              <h2>Gatilho</h2>
              <div className="sub">{descreverGatilho()}</div>
              {gatilho?.tipo === "lista_inscrita" && (
                <>
                  <label>Lista</label>
                  <select value={gatilho.lista_id ?? ""}
                    onChange={(e) => onMudar({ gatilho: { tipo: "lista_inscrita", lista_id: Number(e.target.value) } })}>
                    <option value="">— escolher —</option>
                    {refs.listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
                  </select>
                </>
              )}
              {gatilho?.tipo === "tag_adicionada" && (
                <>
                  <label>Tag</label>
                  <select value={gatilho.tag_id ?? ""}
                    onChange={(e) => onMudar({ gatilho: { tipo: "tag_adicionada", tag_id: Number(e.target.value) } })}>
                    <option value="">— escolher —</option>
                    {refs.tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
                  </select>
                </>
              )}
              {gatilho?.tipo === "lista_descadastrada" && (
                <>
                  <label>Lista (vazio = qualquer uma)</label>
                  <select value={gatilho.lista_id ?? ""}
                    onChange={(e) => onMudar({ gatilho: {
                      tipo: "lista_descadastrada",
                      ...(e.target.value ? { lista_id: Number(e.target.value) } : {}) } })}>
                    <option value="">qualquer lista</option>
                    {refs.listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
                  </select>
                </>
              )}
              {(gatilho?.tipo === "email_aberto" || gatilho?.tipo === "email_clicado") && (
                <div className="aviso">
                  Dispara na primeira abertura (ou clique) que o contato fizer. O registro já
                  acontece hoje — foi assim que o seu teste apareceu no relatório.
                </div>
              )}
              {["compra_realizada", "carrinho_abandonado", "boleto_gerado",
                "pagamento_atrasado", "pagamento_expirou"].includes(gatilho?.tipo) && gatilho && (
                <>
                  <label>Produto (vazio = qualquer um)</label>
                  <input value={gatilho.produto ?? ""} placeholder="parte do nome do produto"
                    onChange={(e) => onMudar({ gatilho: {
                      tipo: gatilho.tipo,
                      ...(e.target.value ? { produto: e.target.value } : {}) } })} />
                  {gatilho?.tipo !== "compra_realizada" && (
                    <div className="aviso" style={{ marginTop: 8 }}>
                      No e-mail deste fluxo você pode escrever <b>%EVENTO.produto%</b> e
                      <b> %EVENTO.valor%</b> — sai o produto que a pessoa deixou para trás,
                      não uma frase genérica.
                    </div>
                  )}
                </>
              )}
              {gatilho?.tipo === "data_do_contato" && (
                <>
                  <label>Campo de data</label>
                  {refs.camposData?.length ? (
                    <select value={gatilho.campo ?? ""}
                      onChange={(e) => onMudar({ gatilho: { ...gatilho, tipo: "data_do_contato", campo: e.target.value } })}>
                      <option value="">— escolher —</option>
                      {refs.camposData.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <div className="aviso">
                      Nenhum campo de data cadastrado ainda. Crie um em <b>Campos</b>
                      (tipo "data") e preencha nos contatos — sem isso este gatilho não
                      tem o que conferir.
                    </div>
                  )}
                  <label>Avisar quantos dias antes</label>
                  <input type="number" min={0} max={60} value={gatilho.dias_antes ?? 0}
                    onChange={(e) => onMudar({ gatilho: { ...gatilho, tipo: "data_do_contato", dias_antes: Number(e.target.value) } })} />
                  <div className="sub" style={{ marginTop: 4 }}>
                    0 = no próprio dia. Compara dia e mês, então serve para data que se
                    repete todo ano, e dispara no máximo uma vez por ano por pessoa.
                  </div>
                </>
              )}
              {gatilho?.tipo === "lead_criado" && (
                <div className="aviso">Dispara para todo contato novo, venha de onde vier: painel, importação, formulário ou API.</div>
              )}
              <div style={{ marginTop: 14 }}>
                <button onClick={() => setSeletor({ tipo: "gatilho" })}>Trocar o gatilho</button>
              </div>
            </>
          ) : (
            <>
              <h2>Passo {editando + 1}</h2>
              <div className="sub">{descreverPasso(passos[editando])}</div>

              <div style={{ marginTop: 12 }}>
                {passos[editando].tipo === "enviar_email" && (
                  <>
                    <label>Mensagem</label>
                    <select value={passos[editando].config.mensagem_id ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { mensagem_id: e.target.value })}>
                      <option value="">— escolher —</option>
                      {refs.mensagens.map((m) => (
                        <option key={m.mensagem_id} value={m.mensagem_id}>{m.nome} · {m.subject}</option>
                      ))}
                    </select>
                  </>
                )}
                {passos[editando].tipo === "esperar" && (
                  <>
                    <label>Quanto tempo</label>
                    <select value={passos[editando].config.duracao ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { duracao: e.target.value })}>
                      <option value="">— escolher —</option>
                      {DURACOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                    </select>
                  </>
                )}
                {passos[editando].tipo === "manychat_tag" && (
                  <>
                    <label>Tag no ManyChat</label>
                    <input value={passos[editando].config.tag ?? ""}
                      placeholder="COMPROU_DESAFIO" list="tags-do-manychat"
                      onChange={(e) => mudarPasso(editando as number, { tag: e.target.value })} />
                    <datalist id="tags-do-manychat">
                      {tagsMC.map((t) => <option key={t} value={t} />)}
                    </datalist>

                    {/* Dizer se a tag existe LÁ, na hora de escolher. Sem isso a
                        pessoa monta o fluxo, ativa, e só descobre que digitou o
                        nome errado quando ninguém recebe mensagem nenhuma. */}
                    {(() => {
                      const escrita = (passos[editando as number].config.tag ?? "").trim();
                      if (!escrita) {
                        return (
                          <div className="sub" style={{ marginTop: 4 }}>
                            {carregandoMC
                              ? "consultando as tags da sua conta…"
                              : tagsMC.length
                                ? `${tagsMC.length} tags na sua conta — comece a digitar para ver as opções.`
                                : "Não consegui ler as tags do ManyChat. Confira a chave em Configurações → ManyChat."}
                          </div>
                        );
                      }
                      const existe = tagsMC.some((t) => t.toLowerCase() === escrita.toLowerCase());
                      return existe ? (
                        <div className="sub" style={{ marginTop: 6, color: "var(--marca)" }}>
                          ✓ <b>{escrita}</b> já existe no ManyChat. O passo vai só aplicá-la —
                          e é ela que dispara o fluxo de lá.
                        </div>
                      ) : (
                        <div className="aviso" style={{ marginTop: 8 }}>
                          <b>{escrita}</b> ainda não existe na sua conta do ManyChat.
                          <div className="sub" style={{ margin: "4px 0 8px" }}>
                            Sem existir, nenhuma automação de lá está escutando por ela. O passo
                            cria a tag ao rodar, mas aí ela nasce sem fluxo pendurado — crie
                            agora e ligue o fluxo no ManyChat antes de ativar isto aqui.
                          </div>
                          <button disabled={!!criandoMC} onClick={() => criarTagMC(escrita)}>
                            {criandoMC === escrita ? "criando…" : "Criar agora no ManyChat"}
                          </button>
                        </div>
                      );
                    })()}
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                      <input type="checkbox"
                        checked={passos[editando].config.criar !== false}
                        onChange={(e) => mudarPasso(editando as number, { criar: e.target.checked })} />
                      Criar o assinante se ele ainda não existir lá
                    </label>
                    <div className="aviso" style={{ marginTop: 10 }}>
                      A busca é pelo WhatsApp, no campo personalizado configurado em
                      <b> Configurações → ManyChat</b>. Sem WhatsApp o passo não cria ninguém —
                      assinante sem número nunca receberia mensagem.
                    </div>
                  </>
                )}
                {(passos[editando].tipo === "aplicar_tag" || passos[editando].tipo === "remover_tag") && (
                  <>
                    <label>Tag</label>
                    <select value={passos[editando].config.tag_id ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { tag_id: Number(e.target.value) })}>
                      <option value="">— escolher —</option>
                      {refs.tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
                    </select>
                  </>
                )}
                {(passos[editando].tipo === "inscrever_lista" || passos[editando].tipo === "desinscrever_lista") && (
                  <>
                    <label>Lista</label>
                    <select value={passos[editando].config.lista_id ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { lista_id: Number(e.target.value) })}>
                      <option value="">— escolher —</option>
                      {refs.listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
                    </select>
                  </>
                )}
                {passos[editando].tipo === "condicao" && (() => {
                  const cfg = passos[editando as number].config;
                  const cd = cfg.condicao ?? {};
                  const mudaCond = (patch: Record<string, any>) =>
                    mudarPasso(editando as number, { ...cfg, condicao: { ...cd, ...patch } });
                  return (
                    <>
                      <label>A condição</label>
                      <select value={cd.tipo ?? ""}
                        onChange={(e) => mudarPasso(editando as number,
                          { ...cfg, condicao: { tipo: e.target.value } })}>
                        <option value="">— escolher —</option>
                        {CONDICOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                      </select>

                      {cd.tipo === "tem_tag" && (
                        <>
                          <label>Tag</label>
                          <select value={cd.tag_id ?? ""}
                            onChange={(e) => mudaCond({ tag_id: Number(e.target.value) })}>
                            <option value="">— escolher —</option>
                            {refs.tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
                          </select>
                        </>
                      )}
                      {cd.tipo === "na_lista" && (
                        <>
                          <label>Lista</label>
                          <select value={cd.lista_id ?? ""}
                            onChange={(e) => mudaCond({ lista_id: Number(e.target.value) })}>
                            <option value="">— escolher —</option>
                            {refs.listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
                          </select>
                        </>
                      )}
                      {(cd.tipo === "abriu_email" || cd.tipo === "clicou_email") && (
                        <>
                          <label>Nos últimos quantos dias</label>
                          <input type="number" value={cd.dias ?? 30}
                            onChange={(e) => mudaCond({ dias: Number(e.target.value) })} />
                        </>
                      )}

                      <label>Se for VERDADEIRO, vai para o passo</label>
                      <input type="number" placeholder="vazio = o próximo"
                        value={cfg.ir_se_verdadeiro ?? ""}
                        onChange={(e) => mudarPasso(editando as number,
                          { ...cfg, ir_se_verdadeiro: e.target.value })} />
                      <label>Se for FALSO, vai para o passo</label>
                      <input type="number" placeholder="vazio = o próximo"
                        value={cfg.ir_se_falso ?? ""}
                        onChange={(e) => mudarPasso(editando as number,
                          { ...cfg, ir_se_falso: e.target.value })} />
                      <div className="sub" style={{ marginTop: 6 }}>
                        O número é a posição do passo, mostrada à direita de cada cartão.
                        Deixe vazio para seguir para o passo seguinte, ou escreva <b>0</b> para
                        encerrar a automação naquele caminho.
                      </div>
                    </>
                  );
                })()}
                {ehGoogle(passos[editando].tipo) && (
                  <>
                    <label>URL do fluxo no n8n</label>
                    <input placeholder="https://seu-n8n.com.br/webhook/…"
                      value={passos[editando].config.url ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { url: e.target.value })} />
                    <div className="aviso" style={{ marginTop: 10 }}>
                      <b>Como funciona:</b> o Ressoa manda o contato completo para o seu n8n, e o
                      n8n escreve {passos[editando].tipo === "google_sheets" ? "na planilha" : "no Drive"}.
                      É exatamente o caminho que a sua automação do ActiveCampaign já usa hoje —
                      lá também é o n8n que escreve, não o AC.
                      <br /><br />
                      No n8n: um nó <b>Webhook</b> recebendo POST, ligado a um nó{" "}
                      <b>{passos[editando].tipo === "google_sheets" ? "Google Sheets → Append Row" : "Google Drive"}</b>.
                      Os campos do contato chegam em <code>contato</code>.
                    </div>
                    <div className="sub" style={{ marginTop: 8 }}>
                      A chave-geral dos webhooks fica em <b>Configurações</b>. Com ela desligada,
                      nenhum POST sai — é a trava contra disparo duplicado com o AC.
                    </div>
                  </>
                )}
                {passos[editando].tipo === "webhook" && (
                  <>
                    <label>URL que recebe o POST</label>
                    <input placeholder="https://seu-n8n.com.br/webhook/…"
                      value={passos[editando].config.url ?? ""}
                      onChange={(e) => mudarPasso(editando as number, { url: e.target.value })} />
                    <div className="sub" style={{ marginTop: 6 }}>
                      A chave-geral dos webhooks fica em <b>Configurações</b>. Com ela desligada,
                      nenhum POST sai — é a trava que evita disparo duplicado.
                    </div>
                  </>
                )}
              </div>

              <div className="linha" style={{ marginTop: 18 }}>
                <button onClick={() => mover(editando as number, -1)}>↑ subir</button>
                <button onClick={() => mover(editando as number, 1)}>↓ descer</button>
                <button className="perigo" onClick={() => removerPasso(editando as number)}>remover</button>
              </div>
            </>
          )}
        </div>
      )}
      {adicionando && (
        <PainelAdicionar
          onFechar={() => setAdicionando(false)}
          onAdicionar={onAdicionarContatos}
          listas={refs.listas}
          tags={refs.tags}
        />
      )}

    </div>
  );
}
