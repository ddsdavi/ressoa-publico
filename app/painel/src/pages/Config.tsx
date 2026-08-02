import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Fontes que existem em Windows, Mac, Android e iOS. Fonte fora desta lista
// não é arriscada: é loteria — o cliente cai para o padrão dele e o e-mail
// que você conferiu não é o e-mail que a pessoa vê.
const FONTES = [
  "Arial, Helvetica, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Trebuchet MS', Tahoma, sans-serif",
  "Verdana, Geneva, sans-serif",
  "'Courier New', Courier, monospace",
  "Tahoma, Verdana, sans-serif",
];

const CORES = [
  { chave: "email_cor_titulo", rotulo: "Títulos", padrao: "#1f1a2e" },
  { chave: "email_cor_texto", rotulo: "Texto", padrao: "#3c3646" },
  { chave: "email_cor_destaque", rotulo: "Destaque e botões", padrao: "#6b4ea8" },
  { chave: "email_cor_fundo", rotulo: "Fundo", padrao: "#f4f1ec" },
];

type Fonte = {
  fonte_id: number; nome: string; url: string;
  lista_fk: number | null; ultima_checagem: string | null;
};

export default function Config() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [novaFonte, setNovaFonte] = useState({ nome: "", url: "", lista_fk: "" });
  const [erroFonte, setErroFonte] = useState("");

  async function carregar() {
    const { data } = await supabase.from("app_config").select("chave, valor");
    setCfg(Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor ?? ""])));
    const { data: f } = await supabase.from("rss_fontes")
      .select("fonte_id,nome,url,lista_fk,ultima_checagem").order("nome");
    setFontes(f ?? []);
    const { data: l } = await supabase.from("listas").select("lista_id,nome").order("nome");
    setListas(l ?? []);
  }
  useEffect(() => { carregar(); }, []);

  async function adicionarFonte() {
    setErroFonte("");
    const url = novaFonte.url.trim();
    if (!novaFonte.nome.trim() || !url) { setErroFonte("Preencha o nome e o endereço."); return; }
    if (!/^https?:\/\//i.test(url)) { setErroFonte("O endereço precisa começar com http:// ou https://"); return; }
    // Confere se o endereço é mesmo um feed ANTES de gravar. Feed errado
    // gravado é uma automação que nunca dispara e ninguém entende por quê.
    try {
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rss?url=${encodeURIComponent(url)}&qtd=1`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" } });
      const d = await r.json();
      if (!d.ok || !d.itens?.length) {
        setErroFonte("Esse endereço não devolveu nenhum post. Confira se é o feed (costuma terminar em /feed ou /rss).");
        return;
      }
    } catch {
      setErroFonte("Não deu para acessar esse endereço agora.");
      return;
    }
    const { error } = await supabase.from("rss_fontes").insert({
      nome: novaFonte.nome.trim(), url,
      lista_fk: novaFonte.lista_fk ? Number(novaFonte.lista_fk) : null,
    });
    if (error) { setErroFonte(error.message); return; }
    setNovaFonte({ nome: "", url: "", lista_fk: "" });
    carregar();
  }

  async function removerFonte(id: number) {
    if (!confirm("Remover este feed? As automações ligadas a ele param de disparar.")) return;
    await supabase.from("rss_fontes").delete().eq("fonte_id", id);
    carregar();
  }

  async function salvar() {
    for (const [chave, valor] of Object.entries(cfg)) {
      await supabase.from("app_config").upsert({ chave, valor, updated_at: new Date().toISOString() });
    }
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2500);
  }

  return (
    <div>
      <h1>Configurações</h1>
      <div className="sub">Provedor de envio, remetente padrão e webhooks de saída.</div>

      {cfg.provedor_email === "simulado" && (
        <div className="aviso">
          <b>Modo simulado ativo:</b> os envios são processados e marcados como enviados, mas nenhum
          e-mail real sai. Quando tiver a conta do provedor e o domínio verificado, preencha a chave
          abaixo e troque o provedor. Trocar de provedor depois não muda mais nada: personalização,
          rastreio, descadastro e relatórios continuam iguais.
        </div>
      )}

      <div className="caixa">
        <h2>Envio de e-mail</h2>
        <label>Provedor</label>
        <select value={cfg.provedor_email ?? "simulado"}
          onChange={(e) => setCfg({ ...cfg, provedor_email: e.target.value })}>
          <option value="simulado">simulado (nenhum e-mail real sai)</option>
          <option value="resend">Resend</option>
          <option value="ses">Amazon SES</option>
        </select>
        <label>Webhooks das automações (n8n / Boost.space)</label>
        <select value={cfg.executar_webhooks ?? "false"}
          onChange={(e) => setCfg({ ...cfg, executar_webhooks: e.target.value })}>
          <option value="false">desligados (seguro durante a transição — evita disparo duplicado com o AC)</option>
          <option value="true">ligados (POSTs reais para n8n/Boost a cada gatilho)</option>
        </select>
        {cfg.provedor_email !== "ses" && (
          <>
            <label>Chave da API do Resend</label>
            <input type="password" value={cfg.resend_api_key ?? ""} placeholder="re_..."
              onChange={(e) => setCfg({ ...cfg, resend_api_key: e.target.value })} />
          </>
        )}
        {cfg.provedor_email === "ses" && (
          <>
            <label>Região da AWS</label>
            <input value={cfg.ses_regiao ?? "us-east-1"} placeholder="us-east-1"
              onChange={(e) => setCfg({ ...cfg, ses_regiao: e.target.value })} />
            <label>Segredo interno do SES</label>
            <input type="password" value={cfg.ses_segredo ?? ""} placeholder="uma frase secreta qualquer"
              onChange={(e) => setCfg({ ...cfg, ses_segredo: e.target.value })} />
            <div className="sub" style={{ marginTop: 6 }}>
              Esta mesma frase precisa estar no segredo <b>SES_SEGREDO</b> da função de envio. As chaves
              da AWS não ficam aqui: elas moram nos segredos da função, fora do banco.
            </div>
          </>
        )}
        <div className="linha">
          <div><label>Nome do remetente padrão</label>
            <input value={cfg.from_name_padrao ?? ""}
              onChange={(e) => setCfg({ ...cfg, from_name_padrao: e.target.value })} /></div>
          <div><label>E-mail do remetente padrão</label>
            <input value={cfg.from_email_padrao ?? ""}
              onChange={(e) => setCfg({ ...cfg, from_email_padrao: e.target.value })} /></div>
        </div>
        <label>Responder para (Reply-To)</label>
        <input value={cfg.reply_to_padrao ?? ""}
          placeholder="contato@seudominio.com.br"
          onChange={(e) => setCfg({ ...cfg, reply_to_padrao: e.target.value })} />
        <div className="sub" style={{ marginTop: 4 }}>
          Precisa ser uma caixa que <b>existe e recebe</b>. O subdomínio de envio só envia —
          quem responder para ele leva "endereço não encontrado", a resposta do cliente se perde
          e o filtro de spam anota que o remetente não aceita mensagem.
        </div>
        <label>Endereço físico no rodapé dos e-mails</label>
        <input value={cfg.endereco_fisico ?? ""}
          placeholder="Razão Social, Rua, nº — Cidade/UF, CEP"
          onChange={(e) => setCfg({ ...cfg, endereco_fisico: e.target.value })} />
        <div className="sub" style={{ marginTop: 4 }}>
          Exigência da lei anti-spam: todo e-mail comercial precisa mostrar o endereço real de
          quem envia. Precisa ser verdadeiro — endereço inventado é sinal de spam para o Gmail,
          além de irregular. Se ficar em branco, o rodapé sai só com o link de descadastro.
        </div>
        <label>URL base do tracking (Edge Functions)</label>
        <input value={cfg.base_url_tracking ?? ""}
          onChange={(e) => setCfg({ ...cfg, base_url_tracking: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar configurações"}</button>
        </div>
      </div>

      <div className="caixa">
        <h2>Identidade visual dos e-mails</h2>
        <div className="sub">
          Vale para todo bloco novo do editor. Trocar aqui não mexe nos e-mails já
          escritos — só nos próximos.
        </div>

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <div>
            <label>Fonte</label>
            <select value={cfg.email_fonte ?? FONTES[0]}
              onChange={(e) => setCfg({ ...cfg, email_fonte: e.target.value })}>
              {FONTES.map((f) => <option key={f} value={f}>{f.split(",")[0]}</option>)}
            </select>
            <div className="sub" style={{ marginTop: 4 }}>
              Só fontes que existem em Windows, Mac e celular. Fonte bonita que o
              cliente não tem vira Times New Roman.
            </div>
          </div>
          <div>
            <label>Largura do e-mail</label>
            <input type="number" min={480} max={800} value={cfg.email_largura ?? "600"}
              onChange={(e) => setCfg({ ...cfg, email_largura: e.target.value })} />
            <div className="sub" style={{ marginTop: 4 }}>600px é o padrão do mercado.</div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14, marginTop: 14,
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {CORES.map((c) => (
            <div key={c.chave}>
              <label>{c.rotulo}</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={cfg[c.chave] ?? c.padrao}
                  style={{ width: 44, height: 32, padding: 2, cursor: "pointer" }}
                  onChange={(e) => setCfg({ ...cfg, [c.chave]: e.target.value })} />
                <input value={cfg[c.chave] ?? c.padrao} style={{ flex: 1 }}
                  onChange={(e) => setCfg({ ...cfg, [c.chave]: e.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {/* prévia: mais rápido de conferir do que abrir o editor */}
        <div style={{
          marginTop: 16, borderRadius: 8, padding: 20, textAlign: "center",
          background: cfg.email_cor_fundo ?? "#f4f1ec",
          fontFamily: cfg.email_fonte ?? FONTES[0],
          border: "1px solid var(--borda)",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: cfg.email_cor_titulo ?? "#1f1a2e" }}>
            Assim vai ficar um título
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: cfg.email_cor_texto ?? "#3c3646", padding: "6px 0 12px" }}>
            E este é o texto comum de um parágrafo do seu e-mail.
          </div>
          <span style={{
            display: "inline-block", padding: "11px 26px", borderRadius: 6, color: "#fff",
            background: cfg.email_cor_destaque ?? "#6b4ea8", fontWeight: 700, fontSize: 15,
          }}>Botão principal</span>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar configurações"}</button>
        </div>
      </div>

      <div className="caixa">
        <h2>Conteúdo (RSS)</h2>
        <div className="sub">
          Cadastre o endereço do feed do seu blog. De hora em hora o sistema confere se
          saiu post novo; quando sai, quem estiver na lista escolhida recebe o aviso pela
          automação com o gatilho <b>Sai um post novo (RSS)</b>.
        </div>

        <table className="tabela">
          <thead><tr><th>Nome</th><th>Endereço do feed</th><th>Avisar a lista</th><th>Última checagem</th><th /></tr></thead>
          <tbody>
            {fontes.map((f) => (
              <tr key={f.fonte_id}>
                <td>{f.nome}</td>
                <td style={{ wordBreak: "break-all", maxWidth: 280 }}>{f.url}</td>
                <td>{listas.find((l) => l.lista_id === f.lista_fk)?.nome ?? <i>nenhuma</i>}</td>
                <td>{f.ultima_checagem ? new Date(f.ultima_checagem).toLocaleString("pt-BR") : "—"}</td>
                <td><button onClick={() => removerFonte(f.fonte_id)}>Remover</button></td>
              </tr>
            ))}
            {!fontes.length && (
              <tr><td colSpan={5} style={{ color: "var(--texto2)" }}>Nenhum feed cadastrado.</td></tr>
            )}
          </tbody>
        </table>

        <div style={{ display: "grid", gap: 10, marginTop: 12,
                      gridTemplateColumns: "1fr 2fr 1fr auto", alignItems: "end" }}>
          <div>
            <label>Nome</label>
            <input value={novaFonte.nome} placeholder="Blog da Patrícia"
              onChange={(e) => setNovaFonte({ ...novaFonte, nome: e.target.value })} />
          </div>
          <div>
            <label>Endereço do feed</label>
            <input value={novaFonte.url} placeholder="https://seublog.com.br/feed"
              onChange={(e) => setNovaFonte({ ...novaFonte, url: e.target.value })} />
          </div>
          <div>
            <label>Avisar a lista</label>
            <select value={novaFonte.lista_fk}
              onChange={(e) => setNovaFonte({ ...novaFonte, lista_fk: e.target.value })}>
              <option value="">— escolher —</option>
              {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
            </select>
          </div>
          <button onClick={adicionarFonte}>Adicionar</button>
        </div>
        {erroFonte && <div className="aviso" style={{ marginTop: 10 }}>{erroFonte}</div>}
      </div>

      <div className="caixa">
        <h2>Webhooks</h2>
        <div className="sub">A gestão de webhooks mudou para a página <b>API &amp; Webhooks</b>.</div>
      </div>
    </div>
  );
}
