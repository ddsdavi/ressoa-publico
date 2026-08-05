import { useEffect, useState } from "react";
import Ajuda from "../components/Ajuda";
import { supabase } from "../lib/supabase";

const BASE_FUNC = "https://SEU-PROJETO.supabase.co/functions/v1";
const BASE_REST = "https://SEU-PROJETO.supabase.co/rest/v1";

function Codigo({ children }: { children: string }) {
  return (
    <pre style={{
      background: "#1c1917", color: "#e7e5e4", borderRadius: 8, padding: "12px 14px",
      fontSize: "calc(12px * var(--escala-texto))", overflowX: "auto", margin: "8px 0 14px", lineHeight: 1.6,
    }}>
      <code>{children}</code>
      <button style={{ float: "right", fontSize: "calc(11px * var(--escala-texto))", padding: "3px 8px", marginTop: -4 }}
        onClick={() => navigator.clipboard.writeText(children)}>copiar</button>
    </pre>
  );
}

const SUBABAS = [
  { id: "entrada", rotulo: "Endereços de entrada",
    sub: "Os endereços para colar na Hotmart, num formulário ou em outro sistema." },
  { id: "saida", rotulo: "Webhooks de saída",
    sub: "Para onde a Ressoa avisa quando algo acontece — n8n, Boost.space, planilha." },
  { id: "api", rotulo: "API de dados",
    sub: "Documentação: como ler e escrever nos seus dados de qualquer sistema." },
];

export default function ApiWebhooks({ embutido }: { embutido?: boolean } = {}) {
  const [sub, setSub] = useState("entrada");
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [autoHooks, setAutoHooks] = useState<{ automacao: string; url: string; ativa: boolean }[]>([]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [novoHook, setNovoHook] = useState({
    nome: "", url: "",
    eventos: "lista_inscrita,tag_adicionada,lead_criado,lead_descadastrado",
  });

  async function carregar() {
    const [w, a, c] = await Promise.all([
      supabase.from("webhooks_saida").select("*").order("created_at"),
      supabase.from("automacao_passos")
        .select("config, automacoes(nome, ativa)").in("tipo", ["webhook", "google_sheets"]),
      supabase.from("app_config").select("chave, valor"),
    ]);
    setWebhooks(w.data ?? []);
    setAutoHooks((a.data ?? [])
      .filter((p: any) => p.config?.url)
      .map((p: any) => ({ automacao: p.automacoes?.nome, url: p.config.url, ativa: p.automacoes?.ativa })));
    setCfg(Object.fromEntries((c.data ?? []).map((r: any) => [r.chave, r.valor ?? ""])));
  }
  useEffect(() => { carregar(); }, []);

  async function criarHook() {
    if (!novoHook.nome || !novoHook.url) { alert("Preencha nome e URL."); return; }
    if (!confirm(`Criar webhook de saída para ${novoHook.url}? Cada evento assinado fará um POST real.`)) return;
    await supabase.from("webhooks_saida").insert({
      nome: novoHook.nome, url: novoHook.url,
      eventos: novoHook.eventos.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setNovoHook({ nome: "", url: "", eventos: "lista_inscrita,tag_adicionada,lead_criado,lead_descadastrado" });
    carregar();
  }

  async function alternarHook(w: any) {
    await supabase.from("webhooks_saida").update({ ativo: !w.ativo }).eq("webhook_id", w.webhook_id);
    carregar();
  }

  async function alternarChaveGeral() {
    const novo = cfg.executar_webhooks === "true" ? "false" : "true";
    if (novo === "true" && !confirm("LIGAR os webhooks das automações? A partir de agora, cada gatilho fará POST REAL para n8n/Boost. Com o ActiveCampaign ainda ativo, isso pode gerar disparo duplicado.")) return;
    await supabase.from("app_config").upsert({ chave: "executar_webhooks", valor: novo, updated_at: new Date().toISOString() });
    carregar();
  }

  return (
    <div>
      {!embutido && <h1>API &amp; Webhooks</h1>}

      {/* Operação e documentação estavam empilhadas na mesma coluna: os
          endereços para colar na Hotmart apareciam depois de quatro blocos
          de exemplo de curl. Quem vem pegar um endereço não quer ler API. */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
        {SUBABAS.map((x) => {
          const ativa = sub === x.id;
          return (
            <button key={x.id} onClick={() => setSub(x.id)}
              style={{
                padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${ativa ? "var(--marca)" : "var(--borda)"}`,
                background: ativa ? "var(--marca)" : "transparent",
                color: ativa ? "#fff" : "var(--texto2)",
                fontSize: "calc(13px * var(--escala-texto))",
              }}>
              {x.rotulo}
            </button>
          );
        })}
      </div>
      <div className="sub" style={{ marginTop: -8, marginBottom: 14 }}>
        {SUBABAS.find((x) => x.id === sub)?.sub}
      </div>

      {sub === "api" && (
      <div className="caixa">
        <h2>Exemplos prontos
          <Ajuda>
            Tudo que o painel faz, qualquer sistema seu pode fazer por aqui — n8n, Make,
            um site, um checkout. A autenticação é por chave no cabeçalho, a mesma
            <code> service_role</code>. <b>Nunca</b> exponha essa chave em site público:
            ela ignora todas as regras de acesso.
          </Ajuda>
        </h2>
        <div className="sub">Base: <code>{BASE_REST}</code></div>
        <label>Buscar leads (igual ao "list contacts" do AC)</label>
        <Codigo>{`curl "${BASE_REST}/tabela_1_leads?select=lead_id,nome,email,whatsapp&email=ilike.*@gmail.com*&limit=10" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY"`}</Codigo>
        <label>Criar/atualizar lead (igual ao "contact sync" do AC)</label>
        <Codigo>{`curl -X POST "${BASE_REST}/tabela_1_leads" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY" \\
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \\
  -d '{"email": "novo@lead.com", "nome": "Novo Lead", "whatsapp": "5561999998888"}'`}</Codigo>
        <label>Aplicar tag num lead (dispara automações, igual ao AC)</label>
        <Codigo>{`curl -X POST "${BASE_REST}/lead_tags" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY" \\
  -H "Content-Type: application/json" -H "Prefer: resolution=ignore-duplicates" \\
  -d '{"lead_fk": "UUID_DO_LEAD", "tag_fk": 42}'`}</Codigo>
        <label>Disparar campanha via API</label>
        <Codigo>{`curl -X POST "${BASE_REST}/rpc/disparar_campanha" \\
  -H "apikey: SUA_SERVICE_KEY" -H "Authorization: Bearer SUA_SERVICE_KEY" \\
  -H "Content-Type: application/json" -d '{"p_campanha": "UUID_DA_CAMPANHA"}'`}</Codigo>
      </div>
      )}

      {sub === "entrada" && (
      <div className="caixa">
        <h2>Endereços para colar<Ajuda>Quase todos são públicos de propósito: quem chama é a Hotmart, um formulário ou o ManyChat, e nenhum deles tem como guardar uma senha sua. A exceção é a captação por API, que escolhe lista e tag no próprio corpo — essa exige a chave de captação.</Ajuda></h2>
        <div style={{ fontSize: "calc(13.5px * var(--escala-texto))", lineHeight: 1.7, marginBottom: 6 }}>
          As portas de entrada do mundo pro seu Active.
        </div>
        <label>Captação com formulário (público — a lista e a tag vêm do cadastro do formulário, nunca do corpo)</label>
        <Codigo>{`curl -X POST "${BASE_FUNC}/formulario" \\
  -H "Content-Type: application/json" \\
  -d '{"form_slug": "meu-formulario", "email": "lead@email.com",
       "nome": "Fulana", "whatsapp": "61999998888"}'`}</Codigo>
        <label>Captação por API, sem formulário (escolhe lista e tag no corpo — exige a chave de captação)</label>
        <Codigo>{`curl -X POST "${BASE_FUNC}/formulario" \\
  -H "Content-Type: application/json" -H "x-api-key: SUA_CHAVE_DE_CAPTACAO" \\
  -d '{"email": "lead@email.com", "nome": "Fulana", "whatsapp": "61999998888",
       "lista_id": 17, "tag_id": 45}'`}</Codigo>
        <div style={{ fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.7, margin: "6px 0 4px" }}>
          A chave de captação se cria em <b>Configurações → API e webhooks</b>. Sem{" "}
          <code>form_slug</code> e sem ela, o POST é recusado — senão qualquer um
          inscreveria qualquer e-mail em qualquer lista, e lista com automação dispara
          e-mail de verdade.
        </div>
        <label>Venda (Hotmart e qualquer outro checkout)</label>
        <Codigo>{`${BASE_FUNC}/venda`}</Codigo>
        <div style={{ fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.7, margin: "6px 0 4px" }}>
          Na Hotmart: <b>Ferramentas → Webhook (API e notificações) → Cadastrar Webhook</b>.
          Escolha <b>Todos os produtos</b> e a versão <b>2.0.0</b>, e marque os eventos de compra —
          incluindo <b>reembolsada</b> e <b>chargeback</b>, que são os que tiram do segmento de
          compradores quem pediu o dinheiro de volta.
        </div>
        <div style={{ fontSize: "calc(13px * var(--escala-texto))", lineHeight: 1.7, marginBottom: 6 }}>
          Uma configuração só cobre a conta inteira: o que cada produto faz ao ser comprado
          fica em <b>Contatos → Vendas</b>, então produto novo não exige voltar na Hotmart.
        </div>
        <label>Ou de qualquer outra origem (Kiwify, Eduzz, checkout próprio)</label>
        <Codigo>{`curl -X POST "${BASE_FUNC}/venda" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "comprador@email.com", "nome": "Fulana", "telefone": "61999998888",
       "produto": "Curso Exemplo", "valor": 197.00,
       "status": "aprovada", "transacao": "ABC123", "data": "2026-08-01"}'`}</Codigo>

        <label>Postback do Resend (resend.com → Webhooks)</label>
        <Codigo>{`${BASE_FUNC}/postback-resend`}</Codigo>
        <label>Postback do Amazon SES (via tópico SNS, quando migrar para a AWS)</label>
        <Codigo>{`${BASE_FUNC}/postback-ses`}</Codigo>
        <label>Tracking e descadastro (o motor injeta sozinho em cada e-mail — só pra referência)</label>
        <Codigo>{`${BASE_FUNC}/rastreio?t=o&e=ENVIO_ID        (pixel de abertura)
${BASE_FUNC}/rastreio?t=c&e=ENVIO_ID&u=URL  (clique rastreado)
${BASE_FUNC}/descadastro?e=ENVIO_ID          (página de descadastro)`}</Codigo>
      </div>
      )}

      {sub === "saida" && (
      <div className="caixa">
        <h2>Para onde avisar<Ajuda>Quando um evento acontece aqui, a Ressoa faz um POST nestes endereços. É como o n8n fica sabendo.</Ajuda></h2>
        <div className="sub">
          O motor faz POST com o contato completo em cada evento assinado — mesmo papel dos webhooks que o AC postava pro seu n8n.
        </div>
        <div className="linha" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: "calc(13.5px * var(--escala-texto))" }}>
            Chave-geral dos webhooks das automações:{" "}
            {cfg.executar_webhooks === "true"
              ? <span className="etiqueta et-verde">LIGADA — POSTs reais</span>
              : <span className="etiqueta et-amarela">DESLIGADA (seguro na transição)</span>}
          </div>
          <button style={{ flex: "0 0 auto" }} onClick={alternarChaveGeral}>
            {cfg.executar_webhooks === "true" ? "Desligar" : "Ligar"}
          </button>
        </div>
        <table>
          <thead><tr><th>Nome</th><th>URL</th><th>Eventos</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {webhooks.map((w) => (
              <tr key={w.webhook_id}>
                <td>{w.nome}</td>
                <td style={{ fontSize: "calc(12px * var(--escala-texto))", fontFamily: "monospace" }}>{w.url}</td>
                <td>{(w.eventos ?? []).map((e: string) => <span key={e} className="etiqueta et-roxa">{e}</span>)}</td>
                <td>{w.ativo ? <span className="etiqueta et-verde">ativo</span> : <span className="etiqueta et-cinza">pausado</span>}</td>
                <td className="direita"><button onClick={() => alternarHook(w)}>{w.ativo ? "Pausar" : "Ativar"}</button></td>
              </tr>
            ))}
            {!webhooks.length && <tr><td colSpan={5} style={{ color: "var(--texto2)" }}>Nenhum webhook global configurado (os das automações estão abaixo).</td></tr>}
          </tbody>
        </table>
        <div className="linha" style={{ marginTop: 12 }}>
          <input placeholder="Nome (ex.: n8n geral)" value={novoHook.nome}
            onChange={(e) => setNovoHook({ ...novoHook, nome: e.target.value })} />
          <input placeholder="https://seu-n8n.com.br/webhook/…" value={novoHook.url}
            onChange={(e) => setNovoHook({ ...novoHook, url: e.target.value })} />
          <input placeholder="eventos separados por vírgula" value={novoHook.eventos}
            onChange={(e) => setNovoHook({ ...novoHook, eventos: e.target.value })} />
          <button className="primario" style={{ flex: "0 0 auto" }} onClick={criarHook}>Adicionar</button>
        </div>
        <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--texto2)", marginTop: 10 }}>
          Eventos disponíveis: <code>lead_criado</code>, <code>lista_inscrita</code>, <code>lista_status_alterado</code>,{" "}
          <code>tag_adicionada</code>, <code>lead_descadastrado</code>. Payload: {"{ evento, payload, contato: { email, nome, whatsapp, listas, tags, atributos } }"}.
        </div>
      </div>
      )}

      {sub === "saida" && (
      <div className="caixa">
        <h2>Herdados do ActiveCampaign<Ajuda>Endereços que já estavam dentro das automações importadas. Ficam aqui para você conferir o que ainda aponta para fora.</Ajuda></h2>
        <table>
          <thead><tr><th>Automação</th><th>Destino</th><th></th></tr></thead>
          <tbody>
            {autoHooks.map((h, i) => (
              <tr key={i}>
                <td>{h.automacao}</td>
                <td style={{ fontSize: "calc(12px * var(--escala-texto))", fontFamily: "monospace" }}>{h.url}</td>
                <td>{h.ativa ? <span className="etiqueta et-verde">automação ativa</span> : <span className="etiqueta et-cinza">automação inativa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: "calc(12.5px * var(--escala-texto))", color: "var(--texto2)", marginTop: 8 }}>
          Estes POSTs só saem com a chave-geral LIGADA — pra não duplicar com o AC enquanto ele existir.
        </div>
      </div>
      )}
    </div>
  );
}
