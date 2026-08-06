import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import Ajuda from "../components/Ajuda";

// Registro de importações e exportações — quem mexeu na base, quando e quanto.
// Exportação de 12 mil contatos é dado pessoal saindo do sistema: precisa de
// rastro, não só de um arquivo baixado que ninguém sabe de onde veio.

type Op = {
  operacao_id: string; direcao: string; nome: string; autor_email: string | null;
  total: number; falhas: number; status: string;
  detalhes: { inseridos?: number; atualizados?: number; invalidos?: number;
             lista?: string | null; tag?: string | null } | null; arquivo: string | null;
  expira_em: string | null; created_at: string; finalizado_em: string | null;
};

const COR: Record<string, string> = {
  completo: "et-verde", processando: "et-amarela", erro: "et-vermelha",
};

export default function Dados() {
  const { podeOperar } = useSessao();
  const [aba, setAba] = useState<"importacao" | "exportacao">("importacao");
  const [ops, setOps] = useState<Op[]>([]);
  const [detalhe, setDetalhe] = useState<Op | null>(null);

  async function carregar() {
    const { data } = await supabase.from("operacoes_dados")
      .select("*").eq("direcao", aba)
      .order("created_at", { ascending: false }).limit(100);
    setOps((data as never) ?? []);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [aba]);

  async function baixar(op: Op) {
    if (!op.arquivo) return;
    const { data, error } = await supabase.storage
      .from("exportacoes").createSignedUrl(op.arquivo, 60);
    if (error || !data) { alert("Arquivo não está mais disponível."); return; }
    window.open(data.signedUrl, "_blank");
  }

  const vencido = (op: Op) => !op.arquivo || (op.expira_em && new Date(op.expira_em) < new Date());

  return (
    <div>
      <h1>Importações e exportações</h1>
      <div className="sub">
        Tudo o que entrou e saiu da base, com autor e data. Arquivos exportados ficam
        guardados por 7 dias; depois disso o registro continua e dá para gerar de novo.
        <Ajuda>
          Este é o livro-caixa dos dados pessoais da operação: quem levou o quê, quando e com
          que filtro. É o que a LGPD espera que exista, e é o que responde “de onde veio esta
          planilha com 12 mil contatos?” meses depois.
          <br /><br />
          As ações ficam nas telas de origem: importar em <b>Leads → Importar CSV</b>,
          exportar em <b>Leads → Exportar CSV</b>. Aqui é só o histórico.
        </Ajuda>
      </div>

      <div className="linha" style={{ margin: "14px 0" }}>
        <button className={aba === "importacao" ? "primario" : ""} style={{ flex: "0 0 auto" }}
          onClick={() => setAba("importacao")}>Importações</button>
        <button className={aba === "exportacao" ? "primario" : ""} style={{ flex: "0 0 auto" }}
          onClick={() => setAba("exportacao")}>Exportações</button>
      </div>

      <div className="caixa">
        <table>
          <thead><tr>
            <th>Nome<Ajuda>Na importação, o nome do arquivo enviado. Na exportação, o filtro que estava na tela — é o que permite reconstruir depois o que foi levado.</Ajuda></th>
            <th>Quem<Ajuda>O e-mail de quem estava logado no momento. Não dá para exportar de forma anônima.</Ajuda></th>
            <th>Criado em</th>
            {aba === "exportacao" && <th>Expira
              <Ajuda>
                O arquivo é apagado depois de 7 dias — dado pessoal não deve ficar parado num
                servidor para sempre. O registro da exportação continua aqui, e para ter o
                arquivo de novo basta exportar outra vez em Leads.
              </Ajuda>
            </th>}
            <th>Contatos<Ajuda>Quantas pessoas a operação tocou: na importação, os que entraram somados aos atualizados; na exportação, as linhas do arquivo.</Ajuda></th>
            {aba === "importacao" && <th>Falhas
              <Ajuda>
                Linhas que não viraram lead: e-mail em branco, e-mail repetido dentro do
                próprio arquivo ou WhatsApp com dígitos repetidos (número falso). Clique em
                “Ver resultados” para o detalhe.
              </Ajuda>
            </th>}
            <th>Status<Ajuda><b>Completo</b> terminou. <b>Processando</b> ainda está rodando. <b>Erro</b> parou no meio — o que já tinha entrado, entrou.</Ajuda></th>
            <th></th>
          </tr></thead>
          <tbody>
            {ops.map((op) => (
              <tr key={op.operacao_id}>
                <td><b>{op.nome}</b></td>
                <td style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                  {op.autor_email ?? "—"}
                </td>
                <td>{new Date(op.created_at).toLocaleString("pt-BR")}</td>
                {aba === "exportacao" && (
                  <td style={{ color: vencido(op) ? "var(--texto2)" : undefined }}>
                    {op.expira_em ? new Date(op.expira_em).toLocaleDateString("pt-BR") : "—"}
                  </td>
                )}
                <td>{op.total.toLocaleString("pt-BR")}</td>
                {aba === "importacao" && (
                  <td style={{ color: op.falhas > 0 ? "var(--perigo, #b3261e)" : undefined }}>
                    {op.falhas}
                  </td>
                )}
                <td>
                  <span className={`etiqueta ${COR[op.status] ?? "et-cinza"}`}>
                    {op.status === "completo" ? "Completo"
                      : op.status === "processando" ? "Processando" : "Erro"}
                  </span>
                </td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  {aba === "importacao"
                    ? <button onClick={() => setDetalhe(op)}>Ver resultados</button>
                    : vencido(op)
                      ? <span style={{ color: "var(--texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>
                          arquivo expirado
                        </span>
                      : <button onClick={() => baixar(op)}>Fazer download</button>}
                </td>
              </tr>
            ))}
            {!ops.length && (
              <tr><td colSpan={7} style={{ color: "var(--texto2)" }}>
                Nenhuma {aba === "importacao" ? "importação" : "exportação"} ainda.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!podeOperar && (
        <div className="aviso">
          Assistentes podem importar e ver este registro, mas não podem exportar a base —
          exportar é levar dado pessoal de milhares de pessoas para fora do sistema.
        </div>
      )}

      {detalhe && (
        <div className="gaveta" style={{ width: 520 }}>
          <button className="fechar" onClick={() => setDetalhe(null)}>✕</button>
          <h2>{detalhe.nome}</h2>
          <div className="sub">
            {new Date(detalhe.created_at).toLocaleString("pt-BR")} · {detalhe.autor_email ?? "—"}
          </div>
          <div className="cartoes" style={{ marginTop: 14 }}>
            <div className="cartao">
              <div className="num">{detalhe.detalhes?.inseridos ?? 0}</div>
              <div className="rot">Novos</div>
            </div>
            <div className="cartao">
              <div className="num">{detalhe.detalhes?.atualizados ?? 0}</div>
              <div className="rot">Atualizados</div>
            </div>
            <div className="cartao">
              <div className="num">{detalhe.falhas}</div>
              <div className="rot">Inválidos ou repetidos</div>
            </div>
          </div>
          {(!!detalhe.detalhes?.lista || !!detalhe.detalhes?.tag) && (
            <div className="caixa" style={{ marginTop: 12 }}>
              <h2>Aplicado na importação</h2>
              {detalhe.detalhes?.lista ? <div>Lista: <b>{String(detalhe.detalhes.lista)}</b></div> : null}
              {detalhe.detalhes?.tag ? <div>Tag: <b>{String(detalhe.detalhes.tag)}</b></div> : null}
              <div className="sub" style={{ marginTop: 6 }}>
                Inscrever numa lista ou aplicar uma tag dispara as automações ligadas a elas.
              </div>
            </div>
          )}
          {detalhe.falhas > 0 && (
            <div className="aviso" style={{ marginTop: 12 }}>
              <b>{detalhe.falhas} linhas não entraram.</b> Quase sempre é e-mail em branco,
              e-mail repetido dentro do próprio arquivo, ou WhatsApp com dígitos repetidos
              (número falso). Nada disso é erro do sistema — são linhas que não deveriam virar lead.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
