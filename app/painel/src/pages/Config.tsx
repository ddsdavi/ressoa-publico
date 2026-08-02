import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import ApiWebhooks from "./ApiWebhooks";
import Ajuda from "../components/Ajuda";

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


// Tudo que é e-mail fica junto: provedor, remetente, aparência e as travas.
// Separar "envio" de "aparência" obrigava a pessoa a lembrar em qual das
// duas estava o que ela procurava, sendo que as duas tratam da mesma coisa.
// O cadeado na aba avisa quando o modo de teste está ligado — esquecer isso
// ligado é campanha que não chega em ninguém.
const ABAS = [
  { id: "email", icone: "✉", rotulo: "E-mail",
    sub: "Provedor, remetente, aparência das mensagens e as travas de envio." },
  { id: "manychat", icone: "💬", rotulo: "ManyChat",
    sub: "A ponte com o WhatsApp e o Instagram." },
  { id: "api", icone: "⌨", rotulo: "API e webhooks",
    sub: "Endereços de entrada e saída, e a chave de acesso aos dados." },
];

export default function Config() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);
  const [mcChave, setMcChave] = useState("");
  const [mcConfigurado, setMcConfigurado] = useState(false);
  const [mcResposta, setMcResposta] = useState("");
  const [aba, setAba] = useState("email");

  async function carregar() {
    const { data } = await supabase.from("app_config").select("chave, valor");
    setCfg(Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor ?? ""])));

    // pergunta se a chave existe, não qual é — a função devolve só o fato
    const { data: seg } = await supabase.rpc("segredos_configurados");
    setMcConfigurado(!!(seg as Record<string, unknown>)?.manychat_api_key);
  }
  useEffect(() => { carregar(); }, []);

  async function salvarManyChat() {
    const { error } = await supabase.rpc("guardar_segredo", {
      p_chave: "manychat_api_key", p_valor: mcChave.trim(),
    });
    if (error) { setMcResposta("Não deu para guardar: " + error.message); return; }
    setMcChave("");
    setMcConfigurado(true);
    setMcResposta("✓ Chave guardada. Clique em Testar para confirmar que o ManyChat aceita.");
  }

  async function testarManyChat() {
    setMcResposta("Conferindo com o ManyChat…");
    try {
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manychat?acao=testar`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" } });
      const d = await r.json();
      setMcResposta(d.ok
        ? `✓ ${d.mensagem}${d.tags?.length ? ". Tags lá: " + d.tags.slice(0, 8).join(", ") : ""}`
        : "O ManyChat recusou a chave. Confira se copiou inteira, em Settings → API.");
    } catch (e) {
      setMcResposta("Não deu para falar com o ManyChat agora: " + (e as Error).message);
    }
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
      <div className="sub">{ABAS.find((a) => a.id === aba)?.sub}</div>

      <div style={{
        display: "flex", gap: 4, flexWrap: "wrap",
        borderBottom: "1px solid var(--borda)", margin: "18px 0 20px",
      }}>
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          return (
            <button key={a.id} onClick={() => setAba(a.id)}
              style={{
                border: "none", background: "transparent", cursor: "pointer",
                padding: "9px 16px", marginBottom: -1,
                borderBottom: `2px solid ${ativa ? "var(--marca)" : "transparent"}`,
                color: ativa ? "var(--texto)" : "var(--texto2)",
                fontWeight: ativa ? 700 : 400,
                fontSize: "calc(14px * var(--escala-texto))",
              }}>
              {a.icone} {a.rotulo}
              {a.id === "email" && (cfg.envio_so_para ?? "").trim() !== "" && (
                <span title="modo de teste ligado" style={{ marginLeft: 6 }}>🔒</span>
              )}
            </button>
          );
        })}
      </div>

      {cfg.provedor_email === "simulado" && (
        <div className="aviso">
          <b>Modo simulado:</b> tudo é processado e marcado como enviado, mas nenhum e-mail
          real sai.
          <Ajuda>
            Para ligar de verdade, preencha a chave do provedor abaixo e troque a opção.
            Nada mais muda: personalização, rastreio, descadastro e relatórios continuam
            iguais em qualquer provedor.
          </Ajuda>
        </div>
      )}

      {aba === "email" && (
      <div className="caixa" style={{ borderLeft: "4px solid var(--perigo)" }}>
        <h2>Trava de envio</h2>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={cfg.envio_pausado === "true"}
            onChange={(e) => setCfg({ ...cfg, envio_pausado: e.target.checked ? "true" : "false" })} />
          <span>
            Pausar todo envio
            <Ajuda>
              Botão de pânico. A fila continua enchendo; só não escoa. Nada se perde: ao
              desligar, sai tudo o que estava esperando.
            </Ajuda>
          </span>
        </label>

        <label style={{ marginTop: 14 }}>
          Só enviar para
          <Ajuda>
            Um ou mais endereços separados por vírgula. Quem não estiver na lista fica
            com o envio marcado como <b>retido</b> — dá para ver quem teria recebido, e
            nada é mandado escondido depois. Vazio = envia normalmente para todos.
          </Ajuda>
        </label>
        <input value={cfg.envio_so_para ?? ""}
          placeholder="vazio = todos"
          onChange={(e) => setCfg({ ...cfg, envio_so_para: e.target.value })} />

        {(cfg.envio_so_para ?? "").trim() !== "" && (
          <div className="aviso" style={{ marginTop: 10 }}>
            Só chega em <b>{cfg.envio_so_para}</b>. Esvazie o campo para operar de verdade.
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>
      </div>
      )}

      {aba === "email" && (
      <div className="caixa">
        <h2>Envio de e-mail</h2>
        <label>Provedor</label>
        <select value={cfg.provedor_email ?? "simulado"}
          onChange={(e) => setCfg({ ...cfg, provedor_email: e.target.value })}>
          <option value="simulado">simulado (nenhum e-mail real sai)</option>
          <option value="resend">Resend</option>
          <option value="ses">Amazon SES</option>
        </select>
        <label>Webhooks das automações
          <Ajuda>
            Enquanto o ActiveCampaign ainda estiver rodando, deixe desligados: os dois
            sistemas disparando o mesmo n8n significa a pessoa recebendo tudo em dobro.
          </Ajuda>
        </label>
        <select value={cfg.executar_webhooks ?? "false"}
          onChange={(e) => setCfg({ ...cfg, executar_webhooks: e.target.value })}>
          <option value="false">desligados</option>
          <option value="true">ligados</option>
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
            <label>Segredo interno do SES
              <Ajuda>
                A mesma frase precisa estar no segredo <b>SES_SEGREDO</b> da função de
                envio. As chaves da AWS não ficam aqui — moram nos segredos da função,
                fora do banco.
              </Ajuda>
            </label>
            <input type="password" value={cfg.ses_segredo ?? ""} placeholder="uma frase secreta qualquer"
              onChange={(e) => setCfg({ ...cfg, ses_segredo: e.target.value })} />

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
        <label>Responder para
          <Ajuda>
            Precisa ser uma caixa que <b>existe e recebe</b>. O subdomínio de envio só
            envia: quem responder para ele leva "endereço não encontrado", a resposta se
            perde, e o filtro de spam anota que o remetente não aceita mensagem.
          </Ajuda>
        </label>
        <input value={cfg.reply_to_padrao ?? ""}
          placeholder="contato@seudominio.com.br"
          onChange={(e) => setCfg({ ...cfg, reply_to_padrao: e.target.value })} />

        <label>Endereço físico no rodapé
          <Ajuda>
            Exigência da lei anti-spam: todo e-mail comercial mostra o endereço real de
            quem envia. Precisa ser verdadeiro — endereço inventado é sinal de spam para
            o Gmail, além de irregular. Em branco, o rodapé sai só com o descadastro.
          </Ajuda>
        </label>
        <input value={cfg.endereco_fisico ?? ""}
          placeholder="Razão Social, Rua, nº — Cidade/UF, CEP"
          onChange={(e) => setCfg({ ...cfg, endereco_fisico: e.target.value })} />

        <label>Endereço das funções públicas
          <Ajuda>
            Onde ficam o pixel de abertura, o rastreio de clique e a página de
            descadastro. Só mude se trocar de projeto no Supabase.
          </Ajuda>
        </label>
        <input value={cfg.base_url_tracking ?? ""}
          onChange={(e) => setCfg({ ...cfg, base_url_tracking: e.target.value })} />
        <div style={{ marginTop: 14 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>
      </div>
      )}

      {aba === "email" && (
      <div className="caixa">
        <h2>Aparência dos e-mails
          <Ajuda>
            Vale para todo bloco novo do editor. Trocar aqui não mexe nos e-mails já
            escritos — mudar o passado estragaria campanha aprovada.
          </Ajuda>
        </h2>


        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <div>
            <label>Fonte
              <Ajuda>
                Só as que existem em Windows, Mac, Android e iOS. Fonte que o cliente não
                tem vira Times New Roman, e o e-mail que você conferiu não é o que a
                pessoa vê.
              </Ajuda>
            </label>
            <select value={cfg.email_fonte ?? FONTES[0]}
              onChange={(e) => setCfg({ ...cfg, email_fonte: e.target.value })}>
              {FONTES.map((f) => <option key={f} value={f}>{f.split(",")[0]}</option>)}
            </select>

          </div>
          <div>
            <label>Largura
              <Ajuda>600px é o padrão do mercado, e o que a maioria dos modelos assume.</Ajuda>
            </label>
            <input type="number" min={480} max={800} value={cfg.email_largura ?? "600"}
              onChange={(e) => setCfg({ ...cfg, email_largura: e.target.value })} />

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
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>
      </div>
      )}

      {aba === "api" && <ApiWebhooks embutido />}

      {aba === "manychat" && (
      <div className="caixa">
        <h2>ManyChat</h2>

        <label style={{ marginTop: 10 }}>
          Chave da API
          {mcConfigurado && <span style={{ color: "var(--marca)" }}> · configurada ✓</span>}
          <Ajuda>
            Pegue em <b>manychat.com → Settings → API</b>. Depois de guardar, ela não
            aparece mais aqui — nem para você: fica num lugar do banco que o navegador não
            lê. Para trocar, digite a nova por cima.
          </Ajuda>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="password" value={mcChave} style={{ flex: 1 }}
            placeholder={mcConfigurado ? "••••••••  (digite para trocar)" : "cole aqui a chave do ManyChat"}
            onChange={(e) => setMcChave(e.target.value)} />
          <button onClick={salvarManyChat} disabled={!mcChave.trim()}>Guardar</button>
          <button onClick={testarManyChat} disabled={!mcConfigurado}>Testar</button>
        </div>
        <label style={{ marginTop: 16 }}>
          Campo que guarda o WhatsApp
          <Ajuda>
            É por ele que a pessoa é encontrada lá, e não por e-mail: quem entra pelo
            WhatsApp ou pelo Instagram chega com e-mail e telefone vazios. Na conta da
            Patrícia o campo se chama <b>WHATSAPP-ID</b>. O número que vai aqui aparece
            na barra de endereço quando você abre o campo no ManyChat.
          </Ajuda>
        </label>
        <input value={cfg.manychat_campo_whatsapp ?? ""} placeholder="ex.: 12378861"
          onChange={(e) => setCfg({ ...cfg, manychat_campo_whatsapp: e.target.value })} />

        {(cfg.manychat_campo_whatsapp ?? "").trim() === "" && mcConfigurado && (
          <div className="aviso" style={{ marginTop: 10 }}>
            Sem isto, ninguém é encontrado lá — e cada compra cria um assinante repetido.
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="primario" onClick={salvar}>{salvo ? "Salvo ✓" : "Salvar"}</button>
        </div>

        {mcResposta && (
          <div className={mcResposta.startsWith("✓") ? "sub" : "aviso"} style={{ marginTop: 10 }}>
            {mcResposta}
          </div>
        )}
      </div>
      )}

      

      
    </div>
  );
}
