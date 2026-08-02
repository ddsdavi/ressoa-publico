import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Envio = {
  envio_id: string; status: string; provider: string | null;
  queued_at: string; sent_at: string | null;
  tabela_1_leads: { email: string | null } | null;
  mensagens: { subject: string } | null;
  campanhas: { nome: string } | null;
};

type Suprimido = {
  email: string; nome: string | null; lead_id: string | null; motivo: string;
  campanha: string | null; assunto: string | null; created_at: string;
};

// O banco guarda um código; aqui ele vira gente. Cada motivo tem peso
// diferente: quem reclamou de spam é mais grave que quem só pediu para sair.
const MOTIVO: Record<string, { rotulo: string; cor: string; explica: string }> = {
  hard_bounce: { rotulo: "E-mail não existe", cor: "et-vermelha",
    explica: "O servidor devolveu em definitivo. Insistir aqui derruba a reputação do domínio." },
  complaint: { rotulo: "Marcou como spam", cor: "et-vermelha",
    explica: "Clicou em “isto é spam”. O mais grave de todos: acima de 0,1% da base, o Gmail passa a mandar tudo para o lixo." },
  unsubscribe_global: { rotulo: "Pediu para sair", cor: "et-amarela",
    explica: "Clicou no descadastro. Sai de todas as listas, não só da que recebeu." },
  ac_import: { rotulo: "Bloqueado no ActiveCampaign", cor: "et-cinza",
    explica: "Já estava bloqueado lá e veio assim na migração. Você começou protegido." },
  manual: { rotulo: "Bloqueio manual", cor: "et-roxa",
    explica: "Alguém do time bloqueou à mão por aqui." },
};
const motivoDe = (m: string) =>
  MOTIVO[m] ?? { rotulo: m, cor: "et-cinza", explica: "Origem não identificada." };

const STATUS_ENVIO: Record<string, string> = {
  queued: "et-amarela", sent: "et-roxa", delivered: "et-verde",
  bounced: "et-vermelha", complained: "et-vermelha", failed: "et-vermelha",
  suppressed: "et-cinza",
};

export default function Envios() {
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [suprimidos, setSuprimidos] = useState<Suprimido[]>([]);
  const [buscaSup, setBuscaSup] = useState("");
  const [novoSup, setNovoSup] = useState("");
  const [porMotivo, setPorMotivo] = useState<{ motivo: string; qtd: number }[]>([]);
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const [totalSup, setTotalSup] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(25);

  async function carregar() {
    const conta = async (filtro: (q: any) => any) => {
      const { count } = await filtro(supabase.from("envios").select("*", { count: "exact", head: true }));
      return count ?? 0;
    };
    const [fila, enviados, entregues, bounces, sup] = await Promise.all([
      conta((q: any) => q.eq("status", "queued")),
      conta((q: any) => q.in("status", ["sent", "delivered"])),
      conta((q: any) => q.eq("status", "delivered")),
      conta((q: any) => q.in("status", ["bounced", "complained"])),
      supabase.from("supressao").select("*", { count: "exact", head: true }).then((r) => r.count ?? 0),
    ]);
    setContagens({ fila, enviados, entregues, bounces, sup });

    const { data } = await supabase.from("envios")
      .select("envio_id, status, provider, queued_at, sent_at, tabela_1_leads(email), mensagens(subject), campanhas(nome)")
      .order("queued_at", { ascending: false }).limit(50);
    setEnvios((data as never) ?? []);

    const c = await supabase.from("app_config").select("chave, valor");
    setCfg(Object.fromEntries((c.data ?? []).map((r) => [r.chave, r.valor ?? ""])));
  }

  // Contagem e busca saem PRONTAS do banco. Trazer as linhas para somar aqui
  // daria número errado: a API corta em 1.000 registros.
  async function carregarSupressao() {
    const busca = buscaSup.trim() || null;
    const motivo = filtroMotivo || null;
    const [lista, total, agrupado] = await Promise.all([
      supabase.rpc("supressao_detalhada", {
        p_busca: busca, p_motivo: motivo,
        p_limite: porPagina, p_offset: pagina * porPagina,
      }),
      supabase.rpc("contar_supressao_filtrada", { p_busca: busca, p_motivo: motivo }),
      supabase.rpc("contagem_supressao"),
    ]);
    setSuprimidos((lista.data as never) ?? []);
    setTotalSup(Number(total.data ?? 0));
    setPorMotivo((agrupado.data as never) ?? []);
  }

  useEffect(() => { carregar(); }, []);
  useEffect(() => { setPagina(0); }, [buscaSup, filtroMotivo, porPagina]);
  useEffect(() => {
    const t = setTimeout(carregarSupressao, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaSup, filtroMotivo, pagina, porPagina]);

  async function adicionarSupressao() {
    const email = novoSup.trim().toLowerCase();
    if (!email) return;
    if (!confirm(`Adicionar ${email} à supressão? Este e-mail NUNCA mais receberá disparos.`)) return;
    const { error } = await supabase.from("supressao").insert({ email, motivo: "manual" });
    if (error) alert(error.message);
    setNovoSup("");
    carregarSupressao(); carregar();
  }

  async function removerSupressao(email: string) {
    if (!confirm(`Remover ${email} da supressão? Ele voltará a poder receber e-mails.`)) return;
    await supabase.from("supressao").delete().eq("email", email);
    carregarSupressao(); carregar();
  }

  const provedorReal = cfg.provedor_email === "resend" && cfg.resend_api_key;

  return (
    <div>
      <h1>Envios</h1>
      <div className="sub">A fila de e-mails, o histórico e a conexão com o provedor.</div>

      <div className="cartoes">
        <div className="cartao"><div className="num">{contagens.fila ?? "…"}</div><div className="rot">Na fila agora</div></div>
        <div className="cartao"><div className="num">{contagens.enviados ?? "…"}</div><div className="rot">Enviados</div></div>
        <div className="cartao"><div className="num">{contagens.entregues ?? "…"}</div><div className="rot">Entregues (confirmado)</div></div>
        <div className="cartao"><div className="num">{contagens.bounces ?? "…"}</div><div className="rot">Bounces/reclamações</div></div>
        <div className="cartao"><div className="num">{contagens.sup ?? "…"}</div><div className="rot">Supressão (exclusões)</div></div>
      </div>

      <div className="caixa">
        <h2>Como o e-mail sai daqui</h2>
        <div style={{ fontSize: "calc(13.5px * var(--escala-texto))", lineHeight: 1.8 }}>
          <b>1.</b> Campanha ou automação enfileira o e-mail na tabela <code>envios</code> (com trava de supressão e status).<br />
          <b>2.</b> A cada minuto o motor drena a fila e entrega ao provedor —
          hoje: <span className={`etiqueta ${provedorReal ? "et-verde" : "et-amarela"}`}>
            {provedorReal ? "Resend (envio real)" : "SIMULADO — nenhum e-mail real sai"}</span><br />
          <b>3.</b> No envio real, o HTML ganha automaticamente: pixel de abertura, link de descadastro e endereço no rodapé.<br />
          <b>4.</b> O provedor devolve postbacks (entregue, abriu, clicou, bounce) que viram métricas e alimentam a supressão.
        </div>
        {!provedorReal && (
          <div className="aviso" style={{ marginTop: 12 }}>
            <b>Para ligar o envio real:</b><br />
            ① conta no provedor → ② verificar o <b>subdomínio</b> de envio (nunca o domínio principal:
            se a reputação se estragar, o e-mail humano continua funcionando) → ③ colar a chave em
            <b> Configurações</b> e trocar o provedor → ④ apontar o webhook do provedor para o endpoint
            de postback, senão bounces e reclamações não entram sozinhos no bloqueio.
          </div>
        )}
      </div>

      <div className="caixa">
        <h2>Últimos 50 envios</h2>
        <table>
          <thead><tr><th>Status</th><th>Para</th><th>Assunto</th><th>Campanha</th><th>Quando</th><th>Provedor</th></tr></thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.envio_id}>
                <td><span className={`etiqueta ${STATUS_ENVIO[e.status] ?? "et-cinza"}`}>{e.status}</span></td>
                <td>{e.tabela_1_leads?.email}</td>
                <td>{e.mensagens?.subject}</td>
                <td>{e.campanhas?.nome ?? <span style={{ color: "var(--texto2)" }}>automação</span>}</td>
                <td>{new Date(e.sent_at ?? e.queued_at).toLocaleString("pt-BR")}</td>
                <td>{e.provider ?? "—"}</td>
              </tr>
            ))}
            {!envios.length && <tr><td colSpan={6} style={{ color: "var(--texto2)" }}>Nenhum envio ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="caixa">
        <h2>Quem está bloqueado e por quê</h2>
        <div className="sub">
          Ninguém desta lista recebe disparo, aconteça o que acontecer — nem por campanha,
          nem por automação, nem por importação. Bounces e reclamações entram aqui sozinhos.
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
          <button className={filtroMotivo === "" ? "primario" : ""} onClick={() => setFiltroMotivo("")}>
            Todos ({porMotivo.reduce((s, m) => s + Number(m.qtd), 0)})
          </button>
          {porMotivo.map((m) => (
            <button key={m.motivo} title={motivoDe(m.motivo).explica}
              className={filtroMotivo === m.motivo ? "primario" : ""}
              onClick={() => setFiltroMotivo(m.motivo)}>
              {motivoDe(m.motivo).rotulo} ({m.qtd})
            </button>
          ))}
        </div>

        {filtroMotivo && (
          <div className="aviso" style={{ marginBottom: 12 }}>{motivoDe(filtroMotivo).explica}</div>
        )}

        <div className="linha">
          <input placeholder="Buscar por nome ou e-mail…" value={buscaSup}
            onChange={(e) => setBuscaSup(e.target.value)} />
          <input placeholder="bloquear um e-mail à mão…" value={novoSup}
            onChange={(e) => setNovoSup(e.target.value)} />
          <button style={{ flex: "0 0 auto" }} onClick={adicionarSupressao}>+ Bloquear</button>
        </div>

        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Pessoa</th><th>Motivo</th><th>Veio de</th><th>Desde</th><th></th></tr></thead>
          <tbody>
            {suprimidos.map((s) => (
              <tr key={s.email}>
                <td>
                  {s.lead_id
                    ? <Link to={`/leads?busca=${encodeURIComponent(s.email)}`}><b>{s.nome || "(sem nome)"}</b></Link>
                    : <b style={{ color: "var(--texto2)" }}>não está mais na base</b>}
                  <div style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>{s.email}</div>
                </td>
                <td>
                  <span className={`etiqueta ${motivoDe(s.motivo).cor}`} title={motivoDe(s.motivo).explica}>
                    {motivoDe(s.motivo).rotulo}
                  </span>
                </td>
                <td style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  {s.campanha ?? s.assunto ?? <span style={{ color: "var(--texto2)" }}>—</span>}
                </td>
                <td>{new Date(s.created_at).toLocaleDateString("pt-BR")}</td>
                <td className="direita">
                  <button className="perigo" onClick={() => removerSupressao(s.email)}>Desbloquear</button>
                </td>
              </tr>
            ))}
            {!suprimidos.length && (
              <tr><td colSpan={5} style={{ color: "var(--texto2)" }}>Ninguém bloqueado com esse filtro.</td></tr>
            )}
          </tbody>
        </table>

        <div className="linha" style={{ marginTop: 10, alignItems: "center" }}>
          <span style={{ color: "var(--texto2)", fontSize: "calc(13px * var(--escala-texto))" }}>
            {totalSup === 0 ? "nenhum" :
              `${pagina * porPagina + 1}–${Math.min((pagina + 1) * porPagina, totalSup)} de ${totalSup}`}
          </span>
          <select style={{ flex: "0 0 auto", width: "auto" }} value={porPagina}
            onChange={(e) => setPorPagina(Number(e.target.value))}>
            {[10, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
          </select>
          <button style={{ flex: "0 0 auto" }} disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}>← anterior</button>
          <button style={{ flex: "0 0 auto" }} disabled={(pagina + 1) * porPagina >= totalSup}
            onClick={() => setPagina((p) => p + 1)}>próxima →</button>
        </div>
      </div>
    </div>
  );
}
