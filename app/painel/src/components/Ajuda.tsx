import { useEffect, useRef, useState } from "react";

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

export default function Ajuda({ children }: { children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <span ref={caixa} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" aria-label="explicação" aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        style={{
          width: 16, height: 16, padding: 0, marginLeft: 5, borderRadius: "50%",
          border: "1px solid var(--borda)", background: aberto ? "var(--marca)" : "transparent",
          color: aberto ? "#fff" : "var(--texto2)", cursor: "pointer",
          fontSize: 11, lineHeight: "14px", verticalAlign: "middle",
        }}>
        ?
      </button>

      {aberto && (
        <span style={{
          position: "absolute", zIndex: 50, left: 0, top: 22, width: 300,
          background: "var(--cartao, #fff)", color: "var(--texto)",
          border: "1px solid var(--borda)", borderRadius: 8, padding: "10px 12px",
          boxShadow: "0 6px 24px rgba(0,0,0,.25)",
          fontSize: "calc(12.5px * var(--escala-texto))", fontWeight: 400,
          lineHeight: 1.6, whiteSpace: "normal", textAlign: "left",
        }}>
          {children}
        </span>
      )}
    </span>
  );
}
