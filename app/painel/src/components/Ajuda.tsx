import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Um "?" que abre a explicação só quando alguém quer.
//
// As telas estavam virando parede de texto: cada campo com dois parágrafos
// embaixo explicando o porquê. Quem já sabe precisa pular tudo isso toda
// vez, e quem não sabe se perde no meio. A explicação continua existindo —
// só sai da frente.
//
// Abre no clique, não no passar do mouse: em celular não existe passar o
// mouse, e tooltip que só aparece no hover é tooltip que metade das
// pessoas nunca vê.
//
// A caixa mora no <body>, não ao lado do "?". Presa ao lado, ela era
// cortada pela rolagem da gaveta e sumia pela direita quando o campo
// ficava perto da borda — justamente nas gavetas, que é onde estão os
// campos que mais precisam de explicação.

type Posicao = { topo: number; esq: number; setaEsq: number; acima: boolean };

export default function Ajuda({ children }: { children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<Posicao | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const id = useId();

  const medir = useCallback(() => {
    const b = botao.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const largura = caixa.current?.offsetWidth ?? Math.min(320, vw - 24);
    const altura = caixa.current?.offsetHeight ?? 160;

    // nasce alinhada com o "?", mas nunca deixa a caixa sair da tela
    let esq = b.left + b.width / 2 - 22;
    esq = Math.max(12, Math.min(esq, vw - largura - 12));

    const cabeAbaixo = b.bottom + 10 + altura <= vh - 12;
    const topo = cabeAbaixo ? b.bottom + 10 : Math.max(12, b.top - 10 - altura);

    // a setinha é o que amarra a explicação ao campo certo: com dois "?"
    // perto um do outro, sem ela não dá para saber de qual deles ela saiu
    const setaEsq = Math.min(
      Math.max(b.left + b.width / 2 - esq - 5, 12),
      Math.max(12, largura - 22),
    );
    setPos({ topo, esq, setaEsq, acima: !cabeAbaixo });
  }, []);

  useLayoutEffect(() => {
    if (aberto) medir(); else setPos(null);
  }, [aberto, medir]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (botao.current?.contains(alvo) || caixa.current?.contains(alvo)) return;
      setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [aberto, medir]);

  return (
    <>
      <button ref={botao} type="button" aria-label="O que é isto?"
        aria-expanded={aberto} aria-describedby={aberto ? id : undefined}
        // dentro de <label> o clique no "?" não pode virar clique na caixinha
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberto((v) => !v); }}
        style={{
          width: 17, height: 17, padding: 0, marginLeft: 6, borderRadius: "50%",
          border: `1px solid ${aberto ? "var(--marca)" : "var(--texto2)"}`,
          background: aberto ? "var(--marca)" : "transparent",
          color: aberto ? "#fff" : "var(--texto2)", cursor: "help",
          fontSize: 11, fontWeight: 700, lineHeight: "15px", verticalAlign: "middle",
          flex: "0 0 auto",
        }}>
        ?
      </button>

      {aberto && createPortal(
        <div ref={caixa} id={id} role="tooltip"
          style={{
            position: "fixed", zIndex: 500,
            top: pos?.topo ?? -9999, left: pos?.esq ?? -9999,
            visibility: pos ? "visible" : "hidden",
            width: "min(320px, calc(100vw - 24px))",
            background: "var(--cartao, #fff)", color: "var(--texto)",
            border: "2px solid var(--marca)", borderRadius: 10,
            boxShadow: "0 12px 36px rgba(0,0,0,.30)",
            fontSize: "calc(13px * var(--escala-texto))", fontWeight: 400,
            lineHeight: 1.65, textAlign: "left", whiteSpace: "normal",
          }}>
          <span aria-hidden="true" style={{
            position: "absolute", left: pos?.setaEsq ?? 12,
            top: pos?.acima ? undefined : -6,
            bottom: pos?.acima ? -6 : undefined,
            width: 10, height: 10, transform: "rotate(45deg)",
            background: "var(--cartao, #fff)",
            borderLeft: pos?.acima ? undefined : "2px solid var(--marca)",
            borderTop: pos?.acima ? undefined : "2px solid var(--marca)",
            borderRight: pos?.acima ? "2px solid var(--marca)" : undefined,
            borderBottom: pos?.acima ? "2px solid var(--marca)" : undefined,
          }} />
          <div style={{
            padding: "12px 14px", maxHeight: "min(60vh, 440px)", overflowY: "auto",
          }}>
            {children}
          </div>
        </div>,
        document.body)}
    </>
  );
}
