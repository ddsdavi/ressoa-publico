import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSessao } from "../lib/sessao";
import Ajuda from "../components/Ajuda";

// Vendas: o que cada produto faz quando é comprado, e o que a Hotmart
// mandou.
//
// A configuração na Hotmart é UMA só, para todos os produtos. Quem decide
// o que acontece com cada um é esta tela — então produto novo não exige
// voltar lá, nem mexer em código.

type Mapa = {
  id: number; padrao_nome: string | null; ucode: string | null; apelido: string | null;
  lista_fk: number | null; tag_fk: number | null; tag_reembolso: number | null; ativo: boolean;
  tag_turma_padrao: string | null; turma_dia_semana: number | null;
  tag_manychat: string | null; tag_manychat_turma: boolean;
  tag_manychat_turma_padrao: string | null;
  turma_hora: number | null; turma_fuso: string | null;
};
type Visto = {
  produto: string; ucode: string | null; eventos: number;
  primeira: string; ultima: string; mapeado: boolean;
};
type Evento = {
  evento_id: string; evento: string | null; email: string | null; produto: string | null;
  transacao: string | null; processado: boolean; situacao: string;
  erro: string | null; recebido_em: string;
};

const vazio = {
  padrao_nome: "", ucode: "", apelido: "",
  lista_fk: "", tag_fk: "", tag_reembolso: "", ativo: true,
  tag_turma_padrao: "", turma_dia_semana: "1", turma_hora: "7",
  tag_manychat: "", tag_manychat_turma: false, tag_manychat_turma_padrao: "",
};

const DIAS: [string, string][] = [
  ["1", "segunda"], ["2", "terça"], ["3", "quarta"], ["4", "quinta"],
  ["5", "sexta"], ["6", "sábado"], ["7", "domingo"],
];

export default function Vendas() {
  const { ehAdmin } = useSessao();
  const [aba, setAba] = useState<"mapa" | "eventos">("mapa");
  const [mapas, setMapas] = useState<Mapa[]>([]);
  const [vistos, setVistos] = useState<Visto[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [listas, setListas] = useState<{ lista_id: number; nome: string }[]>([]);
  const [tags, setTags] = useState<{ tag_id: number; nome: string }[]>([]);
  const [editando, setEditando] = useState<Mapa | "novo" | null>(null);
  const [f, setF] = useState<typeof vazio>(vazio);


  async function carregar() {
    const [m, v, e, l, t] = await Promise.all([
      supabase.from("hotmart_produtos").select("*").order("apelido"),
      supabase.rpc("hotmart_produtos_vistos"),
      supabase.from("hotmart_eventos")
        .select("evento_id, evento, email, produto, transacao, processado, situacao, erro, recebido_em")
        .order("recebido_em", { ascending: false }).limit(100),
      supabase.from("listas").select("lista_id, nome").order("nome"),
      supabase.from("tags").select("tag_id, nome").order("nome"),
    ]);
    setMapas((m.data as never) ?? []);
    setVistos(((v.data as never) ?? []) as Visto[]);
    setEventos((e.data as never) ?? []);
    setListas(l.data ?? []);
    setTags((t.data ?? []) as never);
  }
  useEffect(() => { carregar(); }, []);

  function abrir(x: Mapa | null, pronto?: Visto) {
    setEditando(x ?? "novo");
    setF(x
      ? {
        padrao_nome: x.padrao_nome ?? "", ucode: x.ucode ?? "", apelido: x.apelido ?? "",
        lista_fk: x.lista_fk ? String(x.lista_fk) : "",
        tag_fk: x.tag_fk ? String(x.tag_fk) : "",
        tag_reembolso: x.tag_reembolso ? String(x.tag_reembolso) : "",
        ativo: x.ativo,
        tag_turma_padrao: x.tag_turma_padrao ?? "",
        tag_manychat: x.tag_manychat ?? "",
        tag_manychat_turma: !!x.tag_manychat_turma,
        tag_manychat_turma_padrao: x.tag_manychat_turma_padrao ?? "",
        turma_dia_semana: String(x.turma_dia_semana ?? 1),
        turma_hora: String(x.turma_hora ?? 7),
      }
      : {
        ...vazio,
        padrao_nome: pronto?.produto ?? "",
        ucode: pronto?.ucode ?? "",
        apelido: pronto?.produto ?? "",
      });
  }

  async function salvar() {
    if (!f.padrao_nome.trim() && !f.ucode.trim()) {
      alert("Informe o código do produto (ucode) ou parte do nome — é por um dos dois que o sistema reconhece a compra.");
      return;
    }
    const dados = {
      padrao_nome: f.padrao_nome.trim() || null,
      ucode: f.ucode.trim() || null,
      apelido: f.apelido.trim() || f.padrao_nome.trim(),
      lista_fk: f.lista_fk ? Number(f.lista_fk) : null,
      tag_fk: f.tag_fk ? Number(f.tag_fk) : null,
      tag_reembolso: f.tag_reembolso ? Number(f.tag_reembolso) : null,
      ativo: f.ativo,
      tag_turma_padrao: f.tag_turma_padrao.trim() || null,
      tag_manychat: f.tag_manychat.trim() || null,
      tag_manychat_turma: f.tag_manychat_turma,
      tag_manychat_turma_padrao: f.tag_manychat_turma_padrao.trim() || null,
      turma_dia_semana: f.tag_turma_padrao.trim() ? Number(f.turma_dia_semana) : null,
      turma_hora: f.tag_turma_padrao.trim() ? Number(f.turma_hora) : null,
      turma_fuso: "America/Sao_Paulo",
    };
    const r = editando === "novo"
      ? await supabase.from("hotmart_produtos").insert(dados)
      : await supabase.from("hotmart_produtos").update(dados).eq("id", (editando as Mapa).id);
    if (r.error) { alert(r.error.message); return; }
    setEditando(null); carregar();
  }

  async function excluir(x: Mapa) {
    if (!confirm(`Remover a regra de "${x.apelido}"?\n\nAs compras já registradas não mudam — só as próximas deixam de entrar na lista e receber a tag.`)) return;
    await supabase.from("hotmart_produtos").delete().eq("id", x.id);
    carregar();
  }

  const nomeLista = (id: number | null) => listas.find((l) => l.lista_id === id)?.nome;
  const nomeTag = (id: number | null) => tags.find((t) => t.tag_id === id)?.nome;

  return (
    <div>
      <h1>Produtos e vendas</h1>
      <div className="sub">
        Uma regra por produto: o que acontece com a pessoa quando ela compra.
        <Ajuda>
          A Hotmart avisa a Ressoa a cada compra — isso já funciona e é uma configuração
          só, para todos os produtos (o endereço fica em Configurações → API e webhooks).
          O que muda de produto para produto é o <b>depois</b>: em que lista a pessoa
          entra, que tag ganha, se é marcada no ManyChat. É isso que se define aqui.
          <br /><br />
          Produto sem regra não é perdido: a compra fica registrada em "Eventos
          recebidos". Só não acontece nada com a pessoa.
        </Ajuda>
      </div>

      <div className="linha" style={{ margin: "14px 0" }}>
        <button className={aba === "mapa" ? "primario" : ""} style={{ flex: "0 0 auto" }}
          onClick={() => setAba("mapa")}>Regras dos produtos ({mapas.length})</button>
        <button className={aba === "eventos" ? "primario" : ""} style={{ flex: "0 0 auto" }}
          onClick={() => setAba("eventos")}>Eventos recebidos ({eventos.length})</button>
      </div>

      {aba === "mapa" && (
        <>
          {vistos.some((v) => !v.mapeado) && (
            <div className="aviso">
              <b>Já venderam e ainda não têm regra.</b> As compras estão registradas; só não
              aconteceu nada com quem comprou. Clique para criar a regra:{" "}
              {vistos.filter((v) => !v.mapeado).slice(0, 8).map((v) => (
                <button key={v.produto} style={{ margin: "4px 4px 0 0" }} onClick={() => abrir(null, v)}>
                  configurar {v.produto} ({v.eventos})
                </button>
              ))}
            </div>
          )}

          {ehAdmin && (
            <div className="caixa">
              <button className="primario" onClick={() => abrir(null)}>+ Nova regra de produto</button>
            </div>
          )}

          {/* Um cartão por produto, não uma tabela de sete colunas.
              O que cada regra faz é uma lista de consequências, e lista de
              consequências não cabe em linha: o código do produto tem 36
              caracteres e sozinho quebrava a tabela em cinco linhas. */}
          {mapas.map((x) => {
            const faz = [
              nomeLista(x.lista_fk) && { rotulo: "Entra na lista", valor: nomeLista(x.lista_fk) },
              nomeTag(x.tag_fk) && { rotulo: "Ganha a tag", valor: nomeTag(x.tag_fk) },
              x.tag_turma_padrao && {
                rotulo: "Tag da turma", valor: x.tag_turma_padrao,
                nota: `vira ${DIAS.find(([v]) => v === String(x.turma_dia_semana))?.[1]} às ${x.turma_hora}h`,
              },
              x.tag_manychat && { rotulo: "Marca no ManyChat", valor: x.tag_manychat },
              x.tag_manychat_turma && {
                rotulo: "E a turma no ManyChat",
                valor: x.tag_manychat_turma_padrao || x.tag_turma_padrao || "(igual à daqui)",
              },
              nomeTag(x.tag_reembolso) && {
                rotulo: "Se pedir reembolso", valor: nomeTag(x.tag_reembolso),
              },
            ].filter(Boolean) as { rotulo: string; valor: string; nota?: string }[];

            return (
              <div key={x.id} className="caixa" style={{ opacity: x.ativo ? 1 : 0.55 }}>
                <div className="linha" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: "calc(15px * var(--escala-texto))" }}>{x.apelido}</b>
                    {!x.ativo && <span className="etiqueta et-cinza" style={{ marginLeft: 8 }}>desligada</span>}
                    <div className="sub" style={{ margin: "2px 0 0" }}>
                      reconhecido {x.ucode
                        ? <>pelo código do produto <span title={x.ucode}>
                            <code>{x.ucode.slice(0, 8)}…</code></span></>
                        : <>quando o nome contém “{x.padrao_nome}”</>}
                    </div>
                  </div>
                  {ehAdmin && (
                    <div style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>
                      <button onClick={() => abrir(x)}>Editar</button>{" "}
                      <button className="perigo" onClick={() => excluir(x)}>Excluir</button>
                    </div>
                  )}
                </div>

                {faz.length ? (
                  <div style={{
                    display: "grid", gap: 10, marginTop: 12,
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  }}>
                    {faz.map((f) => (
                      <div key={f.rotulo} style={{
                        border: "1px solid var(--borda)", borderRadius: 8, padding: "9px 11px",
                      }}>
                        <div className="sub" style={{ margin: 0 }}>{f.rotulo}</div>
                        <div style={{ wordBreak: "break-word" }}>{f.valor}</div>
                        {f.nota && <div className="sub" style={{ margin: 0 }}>{f.nota}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="aviso" style={{ marginTop: 12 }}>
                    Esta regra não faz nada ainda: a compra é registrada, mas ninguém entra
                    em lista, recebe tag ou é marcado no ManyChat.
                  </div>
                )}
              </div>
            );
          })}

          {!mapas.length && (
            <div className="caixa">
              <div className="sub">
                Nenhuma regra ainda. Sem regra, a compra é registrada mas ninguém entra em
                lista nem recebe tag — e as automações de comprador não disparam.
              </div>
            </div>
          )}
        </>
      )}

      {aba === "eventos" && (
        <div className="caixa">
          <h2>Tudo o que a Hotmart mandou</h2>
          <div className="sub">
            O corpo original de cada evento fica guardado. Se algo der errado, dá para ver
            exatamente o que chegou — e reprocessar. <b>Fora do escopo</b> não é falha: a
            Hotmart manda muito além de compra (acesso à área de membros, envio de produto
            físico, troca de plano), e esses ficam registrados sem ação.
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr>
              <th>Quando</th><th>Evento</th><th>Comprador</th><th>Produto</th><th>Situação</th>
            </tr></thead>
            <tbody>
              {eventos.map((e) => (
                <tr key={e.evento_id}>
                  <td>{new Date(e.recebido_em).toLocaleString("pt-BR")}</td>
                  <td style={{ fontSize: "calc(12.5px * var(--escala-texto))" }}>{e.evento ?? "—"}</td>
                  <td>{e.email ?? "—"}</td>
                  <td>{e.produto ?? "—"}</td>
                  <td>
                    {e.situacao === "erro"
                      ? <span className="etiqueta et-vermelha" title={e.erro ?? ""}>erro</span>
                      : e.situacao === "processado"
                        ? <span className="etiqueta et-verde">processado</span>
                        : e.situacao === "ignorado"
                          ? <span className="etiqueta et-cinza"
                              title="A Hotmart manda mais que compra: acesso à área de membros, envio de produto, troca de plano. Fica registrado, mas este endereço não age sobre eles.">
                              fora do escopo</span>
                          : <span className="etiqueta et-amarela">pendente</span>}
                  </td>
                </tr>
              ))}
              {!eventos.length && (
                <tr><td colSpan={5} style={{ color: "var(--texto2)" }}>
                  Nada recebido ainda. Assim que a Hotmart mandar o primeiro evento, ele aparece aqui.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <div className="gaveta" style={{ width: 480 }}>
          <button className="fechar" onClick={() => setEditando(null)}>✕</button>
          <h2>{editando === "novo" ? "Nova regra de produto" : "Editar regra"}</h2>

          <label>Nome do produto (como você chama)</label>
          <input value={f.apelido} placeholder="Curso Exemplo"
            onChange={(e) => setF({ ...f, apelido: e.target.value })} />

          <label>Código do produto (ucode)</label>
          <input value={f.ucode} placeholder="vem junto com a venda"
            onChange={(e) => setF({ ...f, ucode: e.target.value })} />
          <div className="sub" style={{ marginTop: 4 }}>
            É o jeito mais seguro de reconhecer: o código não muda quando você renomeia o
            produto na Hotmart. Se não souber, deixe vazio e use o nome abaixo.
          </div>

          <label>Ou parte do nome</label>
          <input value={f.padrao_nome} placeholder="Desafio Casa"
            onChange={(e) => setF({ ...f, padrao_nome: e.target.value })} />
          <div className="sub" style={{ marginTop: 4 }}>
            Basta um pedaço. Se duas regras casarem, ganha a mais específica.
          </div>

          <label>Quando comprar, entra na lista</label>
          <select value={f.lista_fk} onChange={(e) => setF({ ...f, lista_fk: e.target.value })}>
            <option value="">nenhuma</option>
            {listas.map((l) => <option key={l.lista_id} value={l.lista_id}>{l.nome}</option>)}
          </select>

          <label>E ganha a tag</label>
          <select value={f.tag_fk} onChange={(e) => setF({ ...f, tag_fk: e.target.value })}>
            <option value="">nenhuma</option>
            {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
          </select>

          <label>Tag de turma (opcional)</label>
          <input value={f.tag_turma_padrao} placeholder="CASA_H_{AAAA}_{MM}_{DD}"
            onChange={(e) => setF({ ...f, tag_turma_padrao: e.target.value })} />
          <div className="sub" style={{ marginTop: 4 }}>
            Para produto que abre turma nova de tempos em tempos. Quem compra recebe a tag da
            <b> próxima</b> turma, e o sistema cria a tag sozinho quando ela não existir.
            Use <code>{"{AAAA}"}</code>, <code>{"{MM}"}</code> e <code>{"{DD}"}</code> no lugar
            da data. Deixe vazio se o produto não tem turma.
          </div>

          {f.tag_turma_padrao.trim() && (
            <>
              <div className="linha">
                <div style={{ flex: 2 }}>
                  <label>A turma vira toda</label>
                  <select value={f.turma_dia_semana}
                    onChange={(e) => setF({ ...f, turma_dia_semana: e.target.value })}>
                    {DIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label>às</label>
                  <select value={f.turma_hora}
                    onChange={(e) => setF({ ...f, turma_hora: e.target.value })}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, "0")}h</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                Horário de Brasília. A virada é no minuto exato: quem comprar às 06:59 ainda
                entra na turma anterior; às 07:00, já na seguinte.
              </div>
            </>
          )}

          <div style={{
            border: "1px solid var(--borda)", borderRadius: 8,
            padding: "14px 16px", marginTop: 18,
          }}>
            <b>💬 Marcar no ManyChat</b>
            <div className="sub" style={{ margin: "2px 0 10px" }}>
              Assim que a compra é aprovada, a pessoa é procurada no ManyChat pelo WhatsApp
              — e criada lá se ainda não existir. A tag é o que dispara a automação de
              mensagem do lado de lá.
            </div>

            <label>Tag fixa no ManyChat</label>
            <input value={f.tag_manychat} placeholder="COMPROU_DESAFIO_CASA_H"
              onChange={(e) => setF({ ...f, tag_manychat: e.target.value })} />
            <div className="sub" style={{ marginTop: 4 }}>
              Vazio = não marca ninguém lá. A tag é criada no ManyChat se ainda não existir.
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <input type="checkbox" checked={f.tag_manychat_turma}
                onChange={(e) => setF({ ...f, tag_manychat_turma: e.target.checked })} />
              Mandar também a tag da turma
            </label>

            {f.tag_manychat_turma && (
              <>
                <label>Padrão da turma no ManyChat</label>
                <input value={f.tag_manychat_turma_padrao} placeholder="CASA_H_{AA}_{MM}_{DD}"
                  onChange={(e) => setF({ ...f, tag_manychat_turma_padrao: e.target.value })} />
                <div className="sub" style={{ marginTop: 4 }}>
                  Vazio = usa o mesmo padrão daqui. Preencha quando o nome for diferente lá —
                  no ManyChat da Patrícia o ano tem <b>dois</b> dígitos
                  (<code>CASA_H_{"{AA}"}_{"{MM}"}_{"{DD}"}</code>), e mandar o de quatro criaria
                  uma tag paralela que nenhuma automação de lá escuta: a pessoa seria marcada e
                  nada aconteceria.
                </div>
              </>
            )}

            {!f.tag_turma_padrao.trim() && f.tag_manychat_turma && (
              <div className="aviso" style={{ marginTop: 8 }}>
                Este produto não tem turma configurada acima, então não há tag de turma para
                mandar. Preencha a "Tag de turma" ou desmarque esta opção.
              </div>
            )}
          </div>

          <label style={{ marginTop: 18 }}>Se pedir reembolso, ganha a tag</label>
          <select value={f.tag_reembolso} onChange={(e) => setF({ ...f, tag_reembolso: e.target.value })}>
            <option value="">nenhuma</option>
            {tags.map((t) => <option key={t.tag_id} value={t.tag_id}>{t.nome}</option>)}
          </select>
          <div className="sub" style={{ marginTop: 4 }}>
            O reembolso <b>não apaga</b> a compra do histórico — ela fica registrada com o status
            trocado, e a pessoa sai sozinha dos segmentos de comprador. A tag serve para você
            tratá-la à parte se quiser.
          </div>

          <label style={{ marginTop: 14 }}>
            <input type="checkbox" checked={f.ativo}
              onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            Regra ativa
          </label>

          <div className="aviso" style={{ marginTop: 12 }}>
            Entrar na lista e receber a tag <b>disparam as automações</b> ligadas a elas —
            inclusive as que mandam e-mail. Confira em Automações antes de ativar.
          </div>

          <div className="linha" style={{ marginTop: 16 }}>
            <button className="primario" onClick={salvar}>Salvar</button>
            <button onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
