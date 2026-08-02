import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao, type Perfil } from "../lib/sessao";
import { ROTULO_PAPEL, DESCRICAO_PAPEL, PODE } from "../lib/papeis";

const PAPEIS: Record<string, [string, string]> = Object.fromEntries(
  Object.keys(ROTULO_PAPEL).map((k) => [k, [ROTULO_PAPEL[k], DESCRICAO_PAPEL[k]]]),
) as Record<string, [string, string]>;

const STATUS: Record<string, string> = {
  pendente: "et-amarela", aprovado: "et-verde", bloqueado: "et-vermelha",
};

export default function Usuarios() {
  const { ehAdmin, perfil } = useSessao();
  const [lista, setLista] = useState<Perfil[]>([]);
  const [msg, setMsg] = useState("");

  async function carregar() {
    const { data } = await supabase.from("usuarios_ressoa")
      .select("user_id, email, nome, papel, status, admin_mestre").order("created_at");
    setLista((data as Perfil[]) ?? []);
  }
  useEffect(() => { carregar(); }, []);

  async function mudar(u: Perfil, campo: "papel" | "status", valor: string) {
    if (u.admin_mestre) {
      alert("Esta é uma conta de administração permanente — não pode ser alterada.");
      return;
    }
    if (u.user_id === perfil?.user_id) {
      if (!confirm("Atenção: você está alterando a SUA PRÓPRIA conta e pode perder o acesso. Continuar?")) return;
    }
    const { error } = await supabase.from("usuarios_ressoa")
      .update({ [campo]: valor, updated_at: new Date().toISOString() }).eq("user_id", u.user_id);
    if (error) { alert(error.message); return; }
    setMsg(`${u.email}: ${campo} alterado para "${valor}".`);
    carregar();
  }

  if (!ehAdmin) {
    return (
      <div>
        <h1>Usuários</h1>
        <div className="aviso">Somente admins podem gerenciar usuários.</div>
      </div>
    );
  }

  const pendentes = lista.filter((u) => u.status === "pendente");

  return (
    <div>
      <h1>Usuários <span className="contagem">({lista.length})</span></h1>
      <div className="sub">Quem entra no Ressoa e o que cada pessoa pode fazer.</div>

      {pendentes.length > 0 && (
        <div className="aviso">
          <b>{pendentes.length} cadastro(s) aguardando liberação.</b> Ninguém entra antes de você aprovar.
        </div>
      )}
      {msg && <div className="aviso ok">{msg}</div>}

      <div className="caixa">
        <table>
          <thead><tr><th>Pessoa</th><th>Papel</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.user_id}>
                <td>
                  <b>{u.nome || "—"}</b>
                  {u.admin_mestre && <span className="etiqueta et-roxa" style={{ marginLeft: 6 }}>🔒 permanente</span>}
                  <div style={{ color: "var(--ac-texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>{u.email}</div>
                </td>
                <td style={{ minWidth: 190 }}>
                  {u.admin_mestre ? (
                    <span className="etiqueta et-verde">Admin</span>
                  ) : (
                    <select value={u.papel} onChange={(e) => mudar(u, "papel", e.target.value)}>
                      {Object.entries(PAPEIS).map(([v, [rot]]) => <option key={v} value={v}>{rot}</option>)}
                    </select>
                  )}
                </td>
                <td><span className={`etiqueta ${STATUS[u.status]}`}>{u.status}</span></td>
                <td className="direita" style={{ whiteSpace: "nowrap" }}>
                  {u.admin_mestre ? (
                    <span style={{ color: "var(--ac-texto2)", fontSize: "calc(12.5px * var(--escala-texto))" }}>conta protegida</span>
                  ) : (
                    <>
                      {u.status !== "aprovado" && <button className="primario" onClick={() => mudar(u, "status", "aprovado")}>Liberar acesso</button>}{" "}
                      {u.status === "aprovado" && <button className="perigo" onClick={() => mudar(u, "status", "bloqueado")}>Bloquear</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="caixa">
        <h2>O que cada nível pode fazer</h2>
        <table className="tabela-permissoes">
          <thead><tr>
            <th>Ação</th>
            <th className="centro">Admin</th>
            <th className="centro">Terapeuta</th>
            <th className="centro">Assistente</th>
          </tr></thead>
          <tbody>
            {PODE.map((p) => (
              <tr key={p.acao}>
                <td>{p.acao}</td>
                <td className="centro">{p.admin ? <span className="sim">✔</span> : <span className="nao">✕</span>}</td>
                <td className="centro">{p.terapeuta ? <span className="sim">✔</span> : <span className="nao">✕</span>}</td>
                <td className="centro">{p.assistente ? <span className="sim">✔</span> : <span className="nao">✕</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sub" style={{ marginTop: 14, lineHeight: 1.7 }}>
          Em uma frase: <b>Terapeuta MEXE</b> na operação (cria, edita e dispara);{" "}
          <b>Assistente SÓ OLHA</b> (consulta e acompanha, sem alterar nada);{" "}
          <b>Admin</b> faz tudo isso e ainda cuida de configurações, integrações e usuários.<br />
          Novos cadastros nascem como <b>Assistente</b> e <b>pendentes</b> — você libera e escolhe o nível aqui.<br />
          Contas com <b>🔒 permanente</b> não podem ser rebaixadas, bloqueadas nem excluídas.
          As permissões valem no banco de dados: ninguém contorna o próprio nível, nem por fora do painel.
        </div>
      </div>
    </div>
  );
}
