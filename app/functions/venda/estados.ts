// Fonte de verdade dos eventos e status documentados pela Hotmart em
// https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/

export const STATUS_EVENTO: Readonly<Record<string, string>> = Object.freeze({
  PURCHASE_APPROVED: "aprovada",
  PURCHASE_COMPLETE: "aprovada",
  PURCHASE_REFUNDED: "reembolsada",
  PURCHASE_CHARGEBACK: "chargeback",
  PURCHASE_PROTEST: "chargeback",
  PURCHASE_CANCELED: "cancelada",
  PURCHASE_EXPIRED: "expirada",
  PURCHASE_BILLET_PRINTED: "pendente",
  PURCHASE_DELAYED: "pendente",
});

export const STATUS_COMPRA: Readonly<Record<string, string>> = Object.freeze({
  APPROVED: "aprovada",
  COMPLETE: "aprovada",
  REFUNDED: "reembolsada",
  PARTIALLY_REFUNDED: "parcialmente_reembolsada",
  CHARGEBACK: "chargeback",
  DISPUTE: "chargeback",
  CANCELLED: "cancelada",
  BLOCKED: "cancelada",
  EXPIRED: "expirada",
  NO_FUNDS: "pendente",
  OVERDUE: "pendente",
  PRINTED_BILLET: "pendente",
  WAITING_PAYMENT: "pendente",
  PROCESSING_TRANSACTION: "pendente",
  UNDER_ANALISYS: "pendente",
  STARTED: "pendente",
  PRE_ORDER: "pendente",
});

export const EVENTOS_PEDIDO_HOTMART = Object.freeze(Object.keys(STATUS_EVENTO));

export const EVENTOS_INTENCAO = Object.freeze([
  "PURCHASE_OUT_OF_SHOPPING_CART",
  "PURCHASE_BILLET_PRINTED",
  "PURCHASE_DELAYED",
  "PURCHASE_EXPIRED",
]);

export function statusPedidoHotmart(evento: unknown, statusCompra: unknown): string | null {
  return STATUS_COMPRA[String(statusCompra ?? "")]
    ?? STATUS_EVENTO[String(evento ?? "")]
    ?? (ehIntencaoDeCompra(evento) ? "pendente" : null)
    ?? null;
}

export function ehIntencaoDeCompra(evento: unknown): boolean {
  return EVENTOS_INTENCAO.includes(String(evento ?? ""));
}

// PURCHASE_COMPLETE avisa que a garantia venceu sem reembolso: a venda
// virou definitiva. É controle interno — a pessoa já comprou dias antes, e
// quem manda em automação é a APROVAÇÃO da compra, não o fim do prazo de
// arrependimento. O prazo nem é fixo: sete dias é o mínimo do Código de
// Defesa do Consumidor, e o vendedor pode dar mais.
//
// Tratar este aviso como entrada de comprador põe quem comprou na semana
// passada dentro da turma desta semana — e dispara o WhatsApp da turma
// errada. Aconteceu com 19 pessoas em 06/08/2026.
export function ehFimDeGarantia(evento: unknown, statusCompra: unknown): boolean {
  return String(evento ?? "") === "PURCHASE_COMPLETE"
    || String(statusCompra ?? "") === "COMPLETE";
}
