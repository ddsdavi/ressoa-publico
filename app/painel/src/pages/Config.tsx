import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Config() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);

  async function carregar() {
    const { data } = await supabase.from("app_config").select("chave, valor");
    setCfg(Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor ?? ""])));
  }
  useEffect(() => { carregar(); }, []);

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
        <h2>Webhooks</h2>
        <div className="sub">A gestão de webhooks mudou para a página <b>API &amp; Webhooks</b>.</div>
      </div>
    </div>
  );
}
