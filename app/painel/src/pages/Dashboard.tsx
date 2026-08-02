import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao, saudacao, primeiroNome } from "../lib/sessao";

type Contagens = {
  leads: number; ativos: number; suprimidos: number;
  campanhas: number; envios: number; automacoes: number;
};

type Evento = { evento_id: number; tipo: string; created_at: string; processado_em: string | null };

export default function Dashboard() {
  const { perfil } = useSessao();
  const [c, setC] = useState<Contagens | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);

  useEffect(() => {
    (async () => {
      const conta = async (tabela: string, filtro?: (q: any) => any) => {
        let q = supabase.from(tabela).select("*", { count: "exact", head: true });
        if (filtro) q = filtro(q);
        const { count } = await q;
        return count ?? 0;
      };
      const [leads, ativos, suprimidos, campanhas, envios, automacoes] = await Promise.all([
        conta("tabela_1_leads"),
        conta("lead_listas", (q) => q.eq("status", 1)),
        conta("supressao"),
        conta("campanhas"),
        conta("envios"),
        conta("automacoes", (q) => q.eq("ativa", true)),
      ]);
      setC({ leads, ativos, suprimidos, campanhas, envios, automacoes });
      const { data } = await supabase.from("eventos_sistema")
        .select("evento_id, tipo, created_at, processado_em")
        .order("evento_id", { ascending: false }).limit(12);
      setEventos(data ?? []);
    })();
  }, []);

  return (
    <div>
      <div className="saudacao">
        {perfil?.avatar_url
          ? <img src={perfil.avatar_url} alt="" />
          : <div className="inicial">{primeiroNome(perfil).slice(0, 2).toUpperCase()}</div>}
        <div>
          <h1>{saudacao()}, {primeiroNome(perfil)}!</h1>
          <div className="sub" style={{ marginBottom: 0 }}>
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            {" · "}o estado da sua base e do motor, agora.
          </div>
        </div>
      </div>
      <div className="cartoes">
        <div className="cartao"><div className="num">{c?.leads ?? "…"}</div><div className="rot">Leads na base</div></div>
        <div className="cartao"><div className="num">{c?.ativos ?? "…"}</div><div className="rot">Inscrições ativas em listas</div></div>
        <div className="cartao"><div className="num">{c?.suprimidos ?? "…"}</div><div className="rot">E-mails suprimidos (nunca receberão)</div></div>
        <div className="cartao"><div className="num">{c?.campanhas ?? "…"}</div><div className="rot">Campanhas criadas</div></div>
        <div className="cartao"><div className="num">{c?.envios ?? "…"}</div><div className="rot">E-mails processados</div></div>
        <div className="cartao"><div className="num">{c?.automacoes ?? "…"}</div><div className="rot">Automações ativas</div></div>
      </div>
      <div className="caixa">
        <h2>Últimos eventos do motor</h2>
        <table>
          <thead><tr><th>#</th><th>Evento</th><th>Quando</th><th>Processado</th></tr></thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.evento_id}>
                <td>{e.evento_id}</td>
                <td><span className="etiqueta et-roxa">{e.tipo}</span></td>
                <td>{new Date(e.created_at).toLocaleString("pt-BR")}</td>
                <td>{e.processado_em
                  ? <span className="etiqueta et-verde">sim</span>
                  : <span className="etiqueta et-amarela">na fila</span>}</td>
              </tr>
            ))}
            {!eventos.length && <tr><td colSpan={4} style={{ color: "var(--texto2)" }}>Nenhum evento ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
