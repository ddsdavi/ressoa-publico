import assert from "node:assert/strict";
import test from "node:test";

import { DDD_VALIDOS, DDI, ehBrasileiroComDDI, ehNumeroBrasileiro, normWhatsapp } from "./telefone.ts";

// O DDI do Brasil é 55. O DDD de Santa Maria (RS) também é 55. Confundir
// os dois corrompeu um número suíço na base em 08/2026.

test("são 67 DDDs, e não a faixa inteira de 11 a 99", () => {
  assert.equal(DDD_VALIDOS.size, 67);
  for (const inexistente of [20, 23, 25, 26, 29, 30, 36, 39, 40, 50, 52,
                             56, 57, 58, 59, 60, 70, 72, 76, 78, 80, 90]) {
    assert.equal(DDD_VALIDOS.has(inexistente), false, `DDD ${inexistente} não existe`);
  }
  for (const existe of [11, 21, 55, 68, 99]) {
    assert.equal(DDD_VALIDOS.has(existe), true);
  }
});

test("formato oficial: celular começa com 9, fixo com 2 a 5", () => {
  assert.equal(ehNumeroBrasileiro("11999998888"), true);   // celular SP
  assert.equal(ehNumeroBrasileiro("1133334444"), true);    // fixo SP
  assert.equal(ehNumeroBrasileiro("1123334444"), true);    // fixo começando com 2
  assert.equal(ehNumeroBrasileiro("11899998888"), false);  // celular sem o 9
  assert.equal(ehNumeroBrasileiro("1163334444"), false);   // fixo começando com 6
  assert.equal(ehNumeroBrasileiro("20999998888"), false);  // DDD 20 não existe
  assert.equal(ehNumeroBrasileiro("36999998888"), false);  // DDD 36 não existe
});

// ---- o ponto que mais dói: 55 é DDI e é DDD ----

test("DDD 55 (Santa Maria) recebe o DDI e vira 5555…", () => {
  // 11 dígitos: DDD 55 + celular. Falta o país.
  assert.equal(normWhatsapp("55999887766", null), "5555999887766");
  // 10 dígitos: DDD 55 + fixo.
  assert.equal(normWhatsapp("5532221100", null), "555532221100");
});

test("quem já tem o DDI não ganha um segundo", () => {
  assert.equal(normWhatsapp("5555999887766", null), "5555999887766"); // DDI+DDD 55
  assert.equal(normWhatsapp("5511999998888", "BR"), "5511999998888");
  assert.equal(normWhatsapp("551133334444", null), "551133334444");   // fixo completo
  assert.equal(ehBrasileiroComDDI("5555999887766"), true);
  assert.equal(ehBrasileiroComDDI("5520999998888"), false);           // DDD 20 não existe
});

test("compra de fora não ganha o 55 num número que não é brasileiro", () => {
  // O caso que originou este teste veio de uma compradora da Suíça: número
  // com 11 dígitos começando em 41 — igual a um celular de Curitiba —, mas
  // com o assinante começando em 7, e celular brasileiro começa com 9.
  // (Os números aqui são fictícios; a forma é o que importa.)
  assert.equal(normWhatsapp("41791234567", "CH"), "41791234567");
  assert.equal(normWhatsapp("4915112345678", "US"), "4915112345678");
  assert.equal(normWhatsapp("610412345678", "AU"), "610412345678");
});

test("brasileiro morando fora continua levando o 55", () => {
  assert.equal(normWhatsapp("13999990001", "US"), "5513999990001");
  assert.equal(normWhatsapp("21999990002", "AR"), "5521999990002");
  assert.equal(normWhatsapp("11999990003", "US"), "5511999990003");
});

test("número curto de fora ganha o código do país, não o 55", () => {
  assert.equal(normWhatsapp("912345678", "PT"), "351912345678");
  assert.equal(normWhatsapp("351912345678", "PT"), "351912345678");
});

test("o maldito zero do DDD: 55 + 017 é DDI 55 + DDD 17", () => {
  // Antigamente se discava 0 + DDD, e muita gente digita assim até hoje.
  // O padrão apareceu na base real e foi apontado pelo Davi em 06/08/2026;
  // os números abaixo são fictícios, com a mesma forma dos que apareceram.
  assert.equal(normWhatsapp("55017999990004", null), "5517999990004");
  assert.equal(normWhatsapp("55041999990005", null), "5541999990005");
  assert.equal(normWhatsapp("55065999990006", null), "5565999990006");
  assert.equal(normWhatsapp("55011999990007", "BR"), "5511999990007");
  // o zero no comecinho, sem DDI, também some
  assert.equal(normWhatsapp("017999990004", null), "5517999990004");
  assert.equal(normWhatsapp("011999990007", null), "5511999990007");
  // mas 550 + DDD inexistente não vira nada — fica como veio
  assert.equal(normWhatsapp("55020999998888", null), "55020999998888");
});

test("o mapa de países cobre o mundo, não só o que já apareceu", () => {
  assert.equal(DDI.BR, "55");
  assert.equal(DDI.PT, "351");
  assert.equal(DDI.US, "1");
  assert.equal(DDI.JP, "81");
  assert.equal(DDI.AO, "244");   // Angola — mercado de língua portuguesa
  assert.equal(DDI.MZ, "258");   // Moçambique
  assert.equal(DDI.CV, "238");   // Cabo Verde
  assert.ok(Object.keys(DDI).length > 200, "precisa cobrir o mundo todo");
});

test("lixo continua sendo recusado", () => {
  assert.equal(normWhatsapp("", null), null);
  assert.equal(normWhatsapp("999", null), null);
  assert.equal(normWhatsapp("11111111111", null), null);
  assert.equal(normWhatsapp(null, null), null);
  assert.equal(normWhatsapp("(11) 99999-8888", "BR"), "5511999998888");
});
