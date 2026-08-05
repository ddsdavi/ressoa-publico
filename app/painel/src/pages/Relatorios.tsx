import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Relatórios. Tudo chega somado do banco: somar linha a linha no navegador
// é a armadilha nº 1 deste projeto — a API corta em 1.000 registros e a
// conta sai errada sem avisar.

type Resumo = Record<string, number>;
type Cresc = { mes: string; novos: number; acumulado: number };
type Camp = {
  campanha: string; quando: string | null; enviados: number; entregues: number;
  abriram: number; clicaram: number; erros: number; suprimidos: number;
  taxa_abertura: number | null; taxa_clique: number | null;
};
type TagRel = {
  tag: string; leads: number; percentual: number;
  com_email: number; engajados: number; usada_em_automacao: boolean;
};
type Faixa = { faixa: string; ordem: number; leads: number };
type Atrib = {
  valor: string; compradores: number; compras: number;
  receita: number; ticket: number | null; leads: number; conversao: number | null;
};
type Anuncio = {
  anuncio: string; rede: string | null; pagina: string | null;
  compradores: number; receita: number; primeira: string; ultima: string;
};
type ValorCampo = { valor: string; leads: number; percentual: number };

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("pt-BR");

// barra proporcional, sem biblioteca de gráfico: menos peso e funciona
// igual no modo escuro
function Barra({ valor, maximo, cor }: { valor: number; maximo: number; cor?: string }) {
  const pct = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
  return (
    <div style={{ background: "var(--borda)", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: cor ?? "var(--marca)" }} />
    </div>
  );
}

export default function Relatorios() {
  const [aba, setAba] = useState<"base" | "campanhas" | "tags" | "campos" | "origem">("base");
  const [dimensao, setDimensao] = useState("origem_trafego");
  const [atrib, setAtrib] = useState<Atrib[]>([]);
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [semOrigem, setSemOrigem] = useState({ compradores: 0, total: 0 });
  const [resumo, setResumo] = useState<Resumo>({});
  const [cresc, setCresc] = useState<Cresc[]>([]);
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [tags, setTags] = useState<TagRel[]>([]);
  const [campos, setCampos] = useState<{ chave: string; rotulo: string }[]>([]);
  const [campoSel, setCampoSel] = useState("");
  const [valores, setValores] = useState<ValorCampo[]>([]);

  useEffect(() => {
    supabase.rpc("rel_resumo").then(({ data }) => setResumo((data as never) ?? {}));
    supabase.rpc("rel_crescimento", { p_meses: 18 }).then(({ data }) => setCresc((data as never) ?? []));
    supabase.rpc("rel_engajamento").then(({ data }) => setFaixas((data as never) ?? []));
    supabase.rpc("rel_campanhas").then(({ data }) => setCamps((data as never) ?? []));
    supabase.rpc("rel_tags").then(({ data }) => setTags((data as never) ?? []));
    supabase.from("campos_personalizados").select("chave, rotulo").order("rotulo")
      .then(({ data }) => setCampos((data as never) ?? []));
    supabase.rpc("rel_anuncios", { p_limite: 20 })
      .then(({ data }) => setAnuncios((data as never) ?? []));
  }, []);

  useEffect(() => {
    supabase.rpc("rel_atribuicao", { p_campo: dimensao })
      .then(({ data }) => setAtrib(((data as never) ?? []) as Atrib[]));
  }, [dimensao]);

  // quantos compradores NÃO têm origem — é o que diz se dá para confiar
  useEffect(() => {
    supabase.rpc("rel_atribuicao", { p_campo: "origem_trafego" }).then(({ data }) => {
      const d = ((data as never) ?? []) as Atrib[];
      const sem = d.find((x) => x.valor === "(sem origem)");
      setSemOrigem({
        compradores: Number(sem?.compradores ?? 0),
        total: d.reduce((s, x) => s + Number(x.compradores), 0),
      });
    });
  }, []);

  useEffect(() => {
    if (!campoSel) { setValores([]); return; }
    supabase.rpc("rel_campo", { p_chave: campoSel, p_limite: 25 })
      .then(({ data }) => setValores((data as never) ?? []));
  }, [campoSel]);

  const maxCresc = Math.max(1, ...cresc.map((c) => c.novos));
  const maxFaixa = Math.max(1, ...faixas.map((f) => Number(f.leads)));
  const maxTag = Math.max(1, ...tags.slice(0, 20).map((t) => Number(t.leads)));
  const maxValor = Math.max(1, ...valores.map((v) => Number(v.leads)));

  const abas: [typeof aba, string][] = [
    ["base", "A base"], ["origem", "De onde vem o dinheiro"],
    ["campanhas", "Campanhas"], ["tags", "Tags"], ["campos", "Campos"],
  ];
  const DIMENSOES: [string, string][] = [
    ["origem_trafego", "Origem do tráfego"],
    ["rede", "Rede"],
    ["midia", "Paga ou orgânica"],
    ["pagina_captura", "Página de captura"],
    ["veio_de", "Referrer"],
  ];
  const maxReceita = Math.max(1, ...atrib.map((a) => Number(a.receita)));
  const maxAnuncio = Math.max(1, ...anuncios.map((a) => Number(a.receita)));
  const reais = (v: number | null) =>
    "R$ " + Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  return (
    <div>
      <h1>Relatórios</h1>
      <div className="sub">Os números da operação, calculados no banco na hora que você abre.</div>

      <div className="cartoes">
        <div className="cartao"><div className="num">{n(resumo.leads)}</div><div className="rot">Leads na base</div></div>
        <div className="cartao"><div className="num">{n(resumo.elegiveis)}</div><div className="rot">Podem receber e-mail</div></div>
        <div className="cartao"><div className="num">{n(resumo.bloqueados)}</div><div className="rot">Bloqueados</div></div>
        <div className="cartao"><div className="num">{n(resumo.novos_30d)}</div><div className="rot">Novos em 30 dias</div></div>
        <div className="cartao"><div className="num">{n(resumo.enviados_30d)}</div><div className="rot">E-mails em 30 dias</div></div>
      </div>

      <div className="linha" style={{ margin: "14px 0" }}>
        {abas.map(([v, r]) => (
          <button key={v} className={aba === v ? "primario" : ""} style={{ flex: "0 0 auto" }}
            onClick={() => setAba(v)}>{r}</button>
        ))}
      </div>

      {aba === "base" && (
        <>
          <div className="caixa">
            <h2>Quem pode receber</h2>
            <div className="sub">
              Dos {n(resumo.leads)} leads, {n(resumo.elegiveis)} estão ativos em alguma lista e não
              estão bloqueados. A diferença não é perda: é gente que se descadastrou, deu erro de
              entrega ou nunca confirmou — mandar para eles machuca a reputação do domínio.
            </div>
          </div>

          <div className="caixa">
            <h2>Saúde do engajamento</h2>
            <div className="sub">
              Distribuição da pontuação. Enquanto não houver histórico de e-mail, ela reflete
              principalmente há quanto tempo a pessoa entrou — que é a ordem certa para o aquecimento.
            </div>
            <table style={{ marginTop: 10 }}>
              <tbody>
                {faixas.map((f) => (
                  <tr key={f.faixa}>
                    <td style={{ width: 190 }}>{f.faixa}</td>
                    <td style={{ width: 90 }}>{n(f.leads)}</td>
                    <td><Barra valor={Number(f.leads)} maximo={maxFaixa}
                      cor={f.ordem <= 2 ? "var(--verde, #157347)" : f.ordem === 5 ? "var(--vermelho, #b3261e)" : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="caixa">
            <h2>Crescimento da base</h2>
            <div className="sub">Leads novos por mês, nos últimos 18 meses.</div>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Mês</th><th>Novos</th><th>Acumulado</th><th></th></tr></thead>
              <tbody>
                {cresc.map((c) => (
                  <tr key={c.mes}>
                    <td>{new Date(c.mes + "T12:00:00").toLocaleDateString("pt-BR",
                      { month: "short", year: "numeric" })}</td>
                    <td>{n(c.novos)}</td>
                    <td style={{ color: "var(--texto2)" }}>{n(c.acumulado)}</td>
                    <td style={{ width: "45%" }}><Barra valor={Number(c.novos)} maximo={maxCresc} /></td>
                  </tr>
                ))}
                {!cresc.length && <tr><td colSpan={4} className="sub">sem dados</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "origem" && (
        <>
          <div className="caixa">
            <h2>Quanto cada origem trouxe</h2>
            <div className="sub">
              O Meta mostra cliques. Isto mostra <b>dinheiro</b> — que ele não sabe, porque a
              venda acontece fora dele. Só compra aprovada entra: reembolso somando como receita
              faria anúncio ruim parecer bom, e isso leva a investir no lugar errado. A receita
              soma só o que foi pago em reais — venda em moeda estrangeira conta como compra,
              mas não vira R$ na marra.
            </div>
            <div className="linha" style={{ marginTop: 10 }}>
              <select style={{ maxWidth: 300 }} value={dimensao}
                onChange={(e) => setDimensao(e.target.value)}>
                {DIMENSOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr>
                <th>Origem</th><th>Receita</th><th>Compradores</th>
                <th>Compras</th><th>Ticket médio</th><th></th>
              </tr></thead>
              <tbody>
                {atrib.map((a, i) => (
                  <tr key={i}>
                    <td><b>{a.valor}</b></td>
                    <td>{reais(a.receita)}</td>
                    <td>{n(a.compradores)}</td>
                    <td>{n(a.compras)}</td>
                    <td style={{ color: "var(--texto2)" }}>
                      {a.ticket ? reais(a.ticket) : "—"}</td>
                    <td style={{ width: "30%" }}>
                      <Barra valor={Number(a.receita)} maximo={maxReceita} /></td>
                  </tr>
                ))}
                {!atrib.length && <tr><td colSpan={6} className="sub">sem dados ainda</td></tr>}
              </tbody>
            </table>
          </div>

          {semOrigem.compradores > 0 && (
            <div className="aviso">
              <b>{semOrigem.compradores} de {semOrigem.total} compradores estão sem origem.</b>{" "}
              Não é falha: a origem só existe quando a pessoa chega por um link com rastreio.
              Enquanto isso, <b>não existe taxa de conversão confiável</b> — hoje só quem compra
              carrega origem, então qualquer percentual daria perto de 100% por construção.
              A partir de agora os formulários também guardam a origem na captação; assim que
              entrarem leads que não compraram, o número passa a fazer sentido.
            </div>
          )}

          <div className="caixa">
            <h2>Anúncios que mais trouxeram dinheiro</h2>
            <div className="sub">
              Cada linha é um anúncio identificado no link da venda. É por aqui que se decide
              onde colocar mais verba.
            </div>
            <table style={{ marginTop: 10 }}>
              <thead><tr>
                <th>Anúncio</th><th>Rede</th><th>Página</th>
                <th>Compradores</th><th>Receita</th><th>Período</th><th></th>
              </tr></thead>
              <tbody>
                {anuncios.map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))" }}>{a.anuncio}</td>
                    <td>{a.rede ?? "—"}</td>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                      {a.pagina ?? "—"}</td>
                    <td>{n(a.compradores)}</td>
                    <td><b>{reais(a.receita)}</b></td>
                    <td style={{ fontSize: "calc(12px * var(--escala-texto))", color: "var(--texto2)" }}>
                      {new Date(a.primeira + "T12:00").toLocaleDateString("pt-BR")}
                      {a.ultima !== a.primeira && " a " + new Date(a.ultima + "T12:00").toLocaleDateString("pt-BR")}
                    </td>
                    <td style={{ width: "18%" }}>
                      <Barra valor={Number(a.receita)} maximo={maxAnuncio} /></td>
                  </tr>
                ))}
                {!anuncios.length && <tr><td colSpan={7} className="sub">nenhuma venda com anúncio identificado</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "campanhas" && (
        <div className="caixa">
          <h2>Desempenho das campanhas</h2>
          <table>
            <thead><tr>
              <th>Campanha</th><th>Quando</th><th>Enviados</th><th>Entregues</th>
              <th>Abriram</th><th>Clicaram</th><th>Erros</th><th>Pulados</th>
            </tr></thead>
            <tbody>
              {camps.map((c, i) => (
                <tr key={i}>
                  <td><b>{c.campanha}</b></td>
                  <td>{c.quando ? new Date(c.quando).toLocaleDateString("pt-BR") : "—"}</td>
                  <td>{n(c.enviados)}</td>
                  <td>{n(c.entregues)}</td>
                  <td>{n(c.abriram)}{c.taxa_abertura != null &&
                    <span style={{ color: "var(--texto2)" }}> ({c.taxa_abertura}%)</span>}</td>
                  <td>{n(c.clicaram)}{c.taxa_clique != null &&
                    <span style={{ color: "var(--texto2)" }}> ({c.taxa_clique}%)</span>}</td>
                  <td style={{ color: c.erros > 0 ? "var(--vermelho, #b3261e)" : undefined }}>{n(c.erros)}</td>
                  <td style={{ color: "var(--texto2)" }}>{n(c.suprimidos)}</td>
                </tr>
              ))}
              {!camps.length && (
                <tr><td colSpan={8} className="sub">
                  Nenhuma campanha disparada ainda. Os números aparecem aqui depois do primeiro envio.
                </td></tr>
              )}
            </tbody>
          </table>
          {camps.length > 0 && (
            <div className="sub" style={{ marginTop: 10 }}>
              <b>Pulados</b> são os que estavam na lista mas não receberam por estarem bloqueados.
              Aparecem de propósito: some da conta, mas não do relatório.
            </div>
          )}
        </div>
      )}

      {aba === "tags" && (
        <div className="caixa">
          <h2>Estatísticas de tag</h2>
          <div className="sub">
            Quantos leads em cada tag e quantos deles estão engajados (pontuação 20 ou mais).
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr>
              <th>Tag</th><th>Leads</th><th>% da base</th><th>Engajados</th><th>Automação</th><th></th>
            </tr></thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.tag}>
                  <td>{t.tag}</td>
                  <td>{n(t.leads)}</td>
                  <td style={{ color: "var(--texto2)" }}>{t.percentual ?? 0}%</td>
                  <td>{n(t.engajados)}</td>
                  <td>{t.usada_em_automacao
                    ? <span className="etiqueta et-roxa">sim</span>
                    : <span style={{ color: "var(--texto2)" }}>—</span>}</td>
                  <td style={{ width: "28%" }}><Barra valor={Number(t.leads)} maximo={maxTag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "campos" && (
        <div className="caixa">
          <h2>Análise de campo</h2>
          <div className="sub">Quais valores aparecem num campo próprio e com que frequência.</div>
          <select style={{ marginTop: 10, maxWidth: 380 }} value={campoSel}
            onChange={(e) => setCampoSel(e.target.value)}>
            <option value="">— escolher o campo —</option>
            {campos.map((c) => <option key={c.chave} value={c.chave}>{c.rotulo}</option>)}
          </select>

          {campoSel && (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Valor</th><th>Leads</th><th>%</th><th></th></tr></thead>
              <tbody>
                {valores.map((v, i) => (
                  <tr key={i}>
                    <td style={{ wordBreak: "break-word" }}>{v.valor}</td>
                    <td>{n(v.leads)}</td>
                    <td style={{ color: "var(--texto2)" }}>{v.percentual}%</td>
                    <td style={{ width: "35%" }}><Barra valor={Number(v.leads)} maximo={maxValor} /></td>
                  </tr>
                ))}
                {!valores.length && (
                  <tr><td colSpan={4} className="sub">Nenhum lead tem valor nesse campo.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
