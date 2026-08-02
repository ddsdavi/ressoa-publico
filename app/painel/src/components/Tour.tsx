import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessao } from "../lib/sessao";

type Passo = {
  id: string;
  sel?: string;          // elemento destacado (se ausente, balão centralizado)
  rota?: string;         // navega antes de mostrar
  emoji: string;
  titulo: string;
  texto?: string;
  itens?: { nome: string; descricao: string }[];   // lista com destaque (ex.: papéis)
  dica?: string;
  soAdmin?: boolean;
};

const PASSOS: Passo[] = [
  {
    id: "boas-vindas", emoji: "💜", titulo: "Boas-vindas ao Ressoa!",
    texto: "Esta é a plataforma que conversa com a sua base — no lugar do ActiveCampaign, e com os dados na sua mão. Em 1 minutinho te mostro tudo.",
  },
  {
    id: "rail", sel: ".ac-rail", emoji: "🧭", titulo: "O caminho de tudo",
    texto: "Essas barras à esquerda organizam a plataforma: Visão geral, Contatos, Email, Automações e — para quem é Admin — Desenvolvedor, Admin e Configurações.",
    dica: "A barra branca ao lado mostra as páginas da área escolhida.",
  },
  {
    id: "papeis", emoji: "👥", titulo: "Quem faz o que por aqui",
    itens: [
      { nome: "Assistente", descricao: "PREPARA: cria leads, listas, tags e monta a campanha em rascunho. Não dispara e-mail nem exporta a base." },
      { nome: "Terapeuta", descricao: "PREPARA E DISPARA: faz tudo da operação e é quem envia a campanha de verdade." },
      { nome: "Admin", descricao: "tudo isso + configurações, API/webhooks e liberação de usuários." },
    ],
    dica: "A lógica: quem prepara não precisa ser quem aperta enviar — disparo para milhares de pessoas não tem desfazer. E as regras valem no banco: ninguém contorna o próprio nível, nem por fora do sistema.",
  },
  {
    id: "leads", rota: "/leads", sel: ".ac-sidebar a[href='/leads']", emoji: "🌱", titulo: "Seus leads",
    texto: "Toda a base fica aqui. Você filtra por lista, tag, status e WhatsApp, monta segmentos avançados e clica em qualquer pessoa para ver o histórico dela.",
    dica: "Dá para importar por CSV e exportar o filtro atual — no mesmo padrão do ActiveCampaign.",
  },
  {
    id: "listas-tags", rota: "/listas", sel: ".ac-sidebar a[href='/listas']", emoji: "🗂️", titulo: "Listas e Tags",
    texto: "Listas são os públicos e eventos — é para elas que a campanha vai. Tags são marcadores que você aplica nas pessoas. Clique no nome ou na quantidade para ver os leads de cada uma.",
    dica: "Entrar numa lista ou ganhar uma tag é justamente o que dispara as automações.",
  },
  {
    id: "campanhas", rota: "/campanhas", sel: ".ac-sidebar a[href='/campanhas']", emoji: "📣", titulo: "Campanhas",
    texto: "É o disparo pontual: escolhe a mensagem, escolhe quem recebe (listas ou um segmento salvo) e envia ou agenda. Depois, o relatório mostra quem abriu e quem clicou em cada link.",
    dica: "Assistente monta a campanha e deixa em rascunho; o disparo fica com a Terapeuta ou a Admin.",
  },
  {
    id: "mensagens", rota: "/mensagens", sel: ".ac-sidebar a[href='/mensagens']", emoji: "✉️", titulo: "Mensagens",
    texto: "A biblioteca de e-mails — inclusive os 100 que já vieram do ActiveCampaign. Tem editor visual de arrastar e soltar para criar novos sem saber nada de código.",
    dica: "Use {{nome}} no assunto ou no texto para chamar cada pessoa pelo primeiro nome.",
  },
  {
    id: "automacoes", rota: "/automacoes", sel: ".ac-sidebar a[href='/automacoes']", emoji: "⚙️", titulo: "Automações",
    texto: "O que acontece sozinho: alguém entra numa lista ou ganha uma tag e a plataforma envia e-mail, aplica tag, espera dias ou avisa outro sistema.",
    dica: "As automações que você já tinha no ActiveCampaign foram replicadas aqui.",
  },
  {
    id: "envios", rota: "/envios", sel: ".ac-sidebar a[href='/envios']", emoji: "📬", titulo: "Envios e exclusões",
    texto: "A fila de e-mails, o que foi entregue e a lista de supressão — quem nunca mais recebe disparo (bounces e descadastros). Isso protege a reputação do seu domínio.",
  },
  {
    id: "usuarios", rota: "/usuarios", sel: ".ac-rail a[href='/usuarios']", emoji: "🛡️", titulo: "Área do Admin",
    texto: "Aqui você vê todo mundo cadastrado, libera quem acabou de se inscrever e define o nível de cada pessoa. Tem uma tabela mostrando exatamente o que cada nível pode fazer, além do registro de segurança.",
    dica: "Contas marcadas com 🔒 permanente não podem ser rebaixadas nem excluídas por ninguém.",
    soAdmin: true,
  },
  {
    id: "escala", sel: ".escala-grupo", emoji: "🔠", titulo: "Texto do seu jeito",
    texto: "Cinco tamanhos de letra. O número mostra em qual você está — só o texto cresce, o resto da tela continua igual.",
  },
  {
    id: "tema", sel: ".tema-grupo", emoji: "🌗", titulo: "Claro, escuro ou o do seu aparelho",
    texto: "Clique para escolher. A plataforma lembra da sua preferência no próximo acesso.",
  },
  {
    id: "conta", sel: ".menu-conta", emoji: "👤", titulo: "Sua conta",
    texto: "Aqui ficam sua foto, seu nome, seu e-mail e sua senha — e é por aqui que você sai da plataforma.",
    dica: "Trocar de e-mail exige um código enviado para o e-mail atual. Segurança em primeiro lugar.",
  },
  {
    id: "fim", emoji: "🚀", titulo: "Pronto para começar!",
    texto: "É isso. Sempre que quiser rever este passeio, clique no ❓ lá em cima. Bom trabalho!",
  },
];

export default function Tour({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { ehAdmin } = useSessao();
  const navegar = useNavigate();
  const [i, setI] = useState(0);
  const [alvo, setAlvo] = useState<DOMRect | null>(null);

  const passos = PASSOS.filter((p) => !p.soAdmin || ehAdmin);
  const passo = passos[i];

  const medir = useCallback(() => {
    if (!passo?.sel) { setAlvo(null); return; }
    const el = document.querySelector(passo.sel);
    if (!el || !el.getClientRects().length) { setAlvo(null); return; }
    setAlvo(el.getBoundingClientRect());
  }, [passo]);

  useEffect(() => {
    if (!aberto || !passo) return;
    if (passo.rota) navegar(passo.rota);
    // remede algumas vezes: a página pode terminar de montar depois da navegação
    const t = setTimeout(medir, 120);
    const t2 = setTimeout(medir, 420);
    const t3 = setTimeout(medir, 900);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      clearTimeout(t); clearTimeout(t2); clearTimeout(t3);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [aberto, i, passo, medir, navegar]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowRight") avancar();
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  if (!aberto || !passo) return null;

  function fechar() {
    localStorage.setItem("ressoa-tour-visto", "1");
    setI(0);
    aoFechar();
  }
  function avancar() {
    if (i + 1 >= passos.length) fechar();
    else setI(i + 1);
  }

  const p = 10;
  const recorte = alvo
    ? `polygon(0 0,100% 0,100% 100%,0 100%,0 0,
        ${alvo.left - p}px ${alvo.top - p}px,
        ${alvo.right + p}px ${alvo.top - p}px,
        ${alvo.right + p}px ${alvo.bottom + p}px,
        ${alvo.left - p}px ${alvo.bottom + p}px,
        ${alvo.left - p}px ${alvo.top - p}px)`
    : undefined;

  // posiciona o balão perto do alvo — e NUNCA deixa sair da tela
  const vw = window.innerWidth, vh = window.innerHeight;
  const larguraBalao = Math.min(460, vw - 32);
  const alturaEstimada = 300;   // teto seguro; o clamp abaixo cuida do resto
  const margem = 16, folga = 18;
  let estilo: React.CSSProperties;

  if (!alvo) {
    estilo = { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  } else {
    const espacoAbaixo = vh - alvo.bottom;
    const espacoAcima = alvo.top;
    const espacoDireita = vw - alvo.right;
    const espacoEsquerda = alvo.left;
    let topo: number, esq: number;

    if (espacoAbaixo >= alturaEstimada + folga) {
      // cabe embaixo do alvo
      topo = alvo.bottom + folga;
      esq = alvo.left + alvo.width / 2 - larguraBalao / 2;
    } else if (espacoAcima >= alturaEstimada + folga) {
      // cabe acima do alvo
      topo = alvo.top - folga - alturaEstimada;
      esq = alvo.left + alvo.width / 2 - larguraBalao / 2;
    } else if (espacoDireita >= larguraBalao + folga) {
      // alvo alto (ex.: a barra lateral): põe ao lado direito
      esq = alvo.right + folga;
      topo = alvo.top + alvo.height / 2 - alturaEstimada / 2;
    } else if (espacoEsquerda >= larguraBalao + folga) {
      esq = alvo.left - folga - larguraBalao;
      topo = alvo.top + alvo.height / 2 - alturaEstimada / 2;
    } else {
      // sem espaço em lugar nenhum: centraliza
      esq = (vw - larguraBalao) / 2;
      topo = (vh - alturaEstimada) / 2;
    }

    // trava dentro da tela, sempre
    esq = Math.max(margem, Math.min(esq, vw - larguraBalao - margem));
    topo = Math.max(margem, Math.min(topo, vh - alturaEstimada - margem));
    estilo = { top: topo, left: esq };
  }

  return (
    <div className="tour">
      <div className="tour-mascara" style={recorte ? { clipPath: recorte } : undefined} onClick={fechar} />
      {alvo && (
        <div className="tour-brilho" style={{
          top: alvo.top - p, left: alvo.left - p,
          width: alvo.width + p * 2, height: alvo.height + p * 2,
        }} />
      )}
      <div className="tour-balao" style={{ ...estilo, width: larguraBalao }}>
        <div className="tour-topo">
          <span className="tour-emoji">{passo.emoji}</span>
          <b>{passo.titulo}</b>
          <button className="tour-x" onClick={fechar} title="Fechar">✕</button>
        </div>
        {passo.texto && <p>{passo.texto}</p>}
        {passo.itens && (
          <ul className="tour-itens">
            {passo.itens.map((it) => (
              <li key={it.nome}>
                <b>{it.nome}</b> {it.descricao}
              </li>
            ))}
          </ul>
        )}
        {passo.dica && <div className="tour-dica">💡 {passo.dica}</div>}
        <div className="tour-rodape">
          <div className="tour-pontos">
            {passos.map((_, n) => (
              <span key={n} className={n === i ? "on" : n < i ? "feito" : ""} onClick={() => setI(n)} />
            ))}
          </div>
          <div className="tour-botoes">
            {i > 0 && <button onClick={() => setI(i - 1)}>Voltar</button>}
            <button className="primario" onClick={avancar}>
              {i + 1 >= passos.length ? "Começar a usar" : "Avançar"}
            </button>
          </div>
        </div>
        <div className="tour-contador">{i + 1} de {passos.length}</div>
      </div>
    </div>
  );
}

export function tourJaVisto() {
  return localStorage.getItem("ressoa-tour-visto") === "1";
}
