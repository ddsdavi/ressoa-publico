import assert from "node:assert/strict";
import test from "node:test";

import {
  EVENTOS_PEDIDO_HOTMART,
  STATUS_COMPRA,
  ehIntencaoDeCompra,
  statusPedidoHotmart,
} from "./estados.ts";

test("reconhece os nove eventos oficiais de pedido da Hotmart", () => {
  assert.deepEqual(new Set(EVENTOS_PEDIDO_HOTMART), new Set([
    "PURCHASE_APPROVED", "PURCHASE_COMPLETE", "PURCHASE_BILLET_PRINTED",
    "PURCHASE_CANCELED", "PURCHASE_PROTEST", "PURCHASE_REFUNDED",
    "PURCHASE_CHARGEBACK", "PURCHASE_EXPIRED", "PURCHASE_DELAYED",
  ]));
});

test("reconhece todos os status de purchase.status documentados", () => {
  assert.deepEqual(new Set(Object.keys(STATUS_COMPRA)), new Set([
    "APPROVED", "BLOCKED", "CANCELLED", "CHARGEBACK", "COMPLETE",
    "EXPIRED", "NO_FUNDS", "OVERDUE", "PARTIALLY_REFUNDED", "PRE_ORDER",
    "PRINTED_BILLET", "PROCESSING_TRANSACTION", "DISPUTE", "REFUNDED",
    "STARTED", "UNDER_ANALISYS", "WAITING_PAYMENT",
  ]));
});

test("não transforma evento desconhecido em venda aprovada", () => {
  assert.equal(statusPedidoHotmart("PURCHASE_ALGO_NOVO", "ALGO_NOVO"), null);
});

test("o status específico prevalece sobre o nome do evento", () => {
  assert.equal(statusPedidoHotmart("PURCHASE_APPROVED", "REFUNDED"), "reembolsada");
  assert.equal(
    statusPedidoHotmart("PURCHASE_APPROVED", "PARTIALLY_REFUNDED"),
    "parcialmente_reembolsada",
  );
});

test("boleto, atraso e expiração são intenção, não venda aprovada", () => {
  for (const evento of [
    "PURCHASE_OUT_OF_SHOPPING_CART", "PURCHASE_BILLET_PRINTED",
    "PURCHASE_DELAYED", "PURCHASE_EXPIRED",
  ]) {
    assert.equal(ehIntencaoDeCompra(evento), true);
    assert.notEqual(statusPedidoHotmart(evento, null), "aprovada");
  }
  assert.equal(ehIntencaoDeCompra("PURCHASE_APPROVED"), false);
});
