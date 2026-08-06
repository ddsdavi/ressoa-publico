// =====================================================================
// TELEFONE: o 55 do Brasil e o 55 de Santa Maria
//
// O DDI do Brasil é 55. O DDD de Santa Maria (RS) também é 55. Tratar os
// dois como a mesma coisa foi o erro que corrompeu um número suíço na
// base em 08/2026 — e que quase virou uma varredura errada na base toda.
//
// O que separa um do outro NÃO é o "55" em si: é o COMPRIMENTO do número
// inteiro e o que vem depois dele.
//
//   55 9 9999-9999   -> 11 dígitos: DDD 55 + celular. FALTA o DDI.
//   55 55 9 9999-9999 -> 13 dígitos: DDI 55 + DDD 55 + celular. Completo.
//
// Regras oficiais usadas aqui (Anatel / Plano de Numeração Brasileiro):
//   - Existem 67 DDDs. Não é "de 11 a 99": 20, 23, 25, 26, 29, 30, 36,
//     39, 40, 50, 52, 56, 57, 58, 59, 60, 70, 72, 76, 78, 80 e 90 NÃO
//     existem.
//   - Celular tem 9 dígitos e começa com 9 (nono dígito, obrigatório em
//     todo o país desde 2016).
//   - Fixo tem 8 dígitos e começa com 2, 3, 4 ou 5.
//
// https://www.gov.br/anatel/pt-br/regulado/numeracao/nono-digito
// =====================================================================

export const DDD_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,          // São Paulo
  21, 22, 24,                                   // Rio de Janeiro
  27, 28,                                       // Espírito Santo
  31, 32, 33, 34, 35, 37, 38,                   // Minas Gerais
  41, 42, 43, 44, 45, 46,                       // Paraná
  47, 48, 49,                                   // Santa Catarina
  51, 53, 54, 55,                               // Rio Grande do Sul
  61, 62, 64,                                   // DF e Goiás
  63,                                           // Tocantins
  65, 66,                                       // Mato Grosso
  67,                                           // Mato Grosso do Sul
  68,                                           // Acre
  69,                                           // Rondônia
  71, 73, 74, 75, 77,                           // Bahia
  79,                                           // Sergipe
  81, 87,                                       // Pernambuco
  82,                                           // Alagoas
  83,                                           // Paraíba
  84,                                           // Rio Grande do Norte
  85, 88,                                       // Ceará
  86, 89,                                       // Piauí
  91, 93, 94,                                   // Pará
  92, 97,                                       // Amazonas
  95,                                           // Roraima
  96,                                           // Amapá
  98, 99,                                       // Maranhão
]);

/** O número, SEM DDI, é um telefone brasileiro válido? */
export function ehNumeroBrasileiro(d: string): boolean {
  if (d.length !== 10 && d.length !== 11) return false;
  if (!DDD_VALIDOS.has(Number(d.slice(0, 2)))) return false;
  const assinante = d.slice(2);
  if (assinante.length === 9) return assinante[0] === "9";        // celular
  return "2345".includes(assinante[0]);                            // fixo
}

/** Já vem completo: DDI 55 + DDD válido + assinante válido. */
export function ehBrasileiroComDDI(d: string): boolean {
  if (d.length !== 12 && d.length !== 13) return false;
  if (!d.startsWith("55")) return false;
  return ehNumeroBrasileiro(d.slice(2));
}

// Código de país (DDI) de TODO país e território, pelo ISO 3166-1 alpha-2.
// Sem o código, o número não serve para WhatsApp nenhum — e descartá-lo
// era pior: quem comprava de Portugal ficava sem telefone na base.
// Fonte: https://en.wikipedia.org/wiki/List_of_country_calling_codes
export const DDI: Record<string, string> = {
  // zona 1 — América do Norte e Caribe
  US: "1", CA: "1", BS: "1", BB: "1", AI: "1", AG: "1", VG: "1", VI: "1",
  KY: "1", BM: "1", GD: "1", TC: "1", JM: "1", MS: "1", MP: "1", GU: "1",
  AS: "1", SX: "1", LC: "1", DM: "1", VC: "1", PR: "1", DO: "1", TT: "1",
  KN: "1",
  // zona 2 — África
  EG: "20", SS: "211", MA: "212", EH: "212", DZ: "213", TN: "216", LY: "218",
  GM: "220", SN: "221", MR: "222", ML: "223", GN: "224", CI: "225", BF: "226",
  NE: "227", TG: "228", BJ: "229", MU: "230", LR: "231", SL: "232", GH: "233",
  NG: "234", TD: "235", CF: "236", CM: "237", CV: "238", ST: "239", GQ: "240",
  GA: "241", CG: "242", CD: "243", AO: "244", GW: "245", IO: "246", AC: "247",
  SC: "248", SD: "249", RW: "250", ET: "251", SO: "252", DJ: "253", KE: "254",
  TZ: "255", UG: "256", BI: "257", MZ: "258", ZM: "260", MG: "261", RE: "262",
  YT: "262", TF: "262", ZW: "263", NA: "264", MW: "265", LS: "266", BW: "267",
  SZ: "268", KM: "269", ZA: "27", SH: "290", TA: "290", ER: "291", AW: "297",
  FO: "298", GL: "299",
  // zonas 3 e 4 — Europa
  GR: "30", NL: "31", BE: "32", FR: "33", ES: "34", GI: "350", PT: "351",
  LU: "352", IE: "353", IS: "354", AL: "355", MT: "356", CY: "357", FI: "358",
  AX: "358", BG: "359", LT: "370", LV: "371", EE: "372", MD: "373", AM: "374",
  BY: "375", AD: "376", MC: "377", SM: "378", VA: "379", UA: "380", RS: "381",
  ME: "382", XK: "383", HR: "385", SI: "386", BA: "387", MK: "389", RO: "40",
  CH: "41", CZ: "420", SK: "421", LI: "423", AT: "43", GB: "44", DK: "45",
  SE: "46", NO: "47", PL: "48", DE: "49",
  // zona 5 — América Latina
  PE: "51", MX: "52", CU: "53", AR: "54", BR: "55", CL: "56", CO: "57",
  VE: "58", FK: "500", GS: "500", BZ: "501", GT: "502", SV: "503", HN: "504",
  NI: "505", CR: "506", PA: "507", PM: "508", HT: "509", GP: "590", BL: "590",
  MF: "590", BO: "591", GY: "592", EC: "593", GF: "594", PY: "595", MQ: "596",
  SR: "597", UY: "598", BQ: "599", CW: "599",
  // zona 6 — Sudeste Asiático e Oceania
  MY: "60", AU: "61", CX: "61", CC: "61", ID: "62", PH: "63", NZ: "64",
  PN: "64", SG: "65", TH: "66", TL: "670", NF: "672", AQ: "672", BN: "673",
  NR: "674", PG: "675", TO: "676", SB: "677", VU: "678", FJ: "679", PW: "680",
  WF: "681", CK: "682", NU: "683", WS: "685", KI: "686", NC: "687", TV: "688",
  PF: "689", TK: "690", FM: "691", MH: "692",
  // zona 7 — Rússia e Cazaquistão
  RU: "7", KZ: "7",
  // zona 8 — Leste Asiático
  JP: "81", KR: "82", VN: "84", CN: "86", KP: "850", HK: "852", MO: "853",
  KH: "855", LA: "856", BD: "880", TW: "886",
  // zona 9 — Oriente Médio e Sul da Ásia
  TR: "90", IN: "91", PK: "92", AF: "93", LK: "94", MM: "95", MV: "960",
  LB: "961", JO: "962", SY: "963", IQ: "964", KW: "965", SA: "966", YE: "967",
  OM: "968", PS: "970", AE: "971", IL: "972", BH: "973", QA: "974", BT: "975",
  MN: "976", NP: "977", TJ: "992", TM: "993", AZ: "994", GE: "995", KG: "996",
  UZ: "998",
};

/**
 * Devolve o telefone pronto para o WhatsApp, com código de país.
 * `pais` é o ISO de 2 letras da compra (BR, PT, US...), quando a origem
 * souber informar — ele desempata o que o formato sozinho não resolve.
 */
export function normWhatsapp(p: string | null | undefined, pais?: string | null): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;

  // repetição pura (00000000000, 99999999999) é lixo de formulário
  if (new Set(d.split("")).size <= 1) return null;

  // 1) Já é um brasileiro completo? Nada a fazer. Isto vem ANTES de
  //    tudo: é o que impede um segundo 55 em quem já tem o seu.
  if (ehBrasileiroComDDI(d)) return d;

  // 2) Brasileiro sem o DDI (inclui o DDD 55 de Santa Maria).
  if (ehNumeroBrasileiro(d)) return "55" + d;

  // 3) O maldito zero do DDD. Antigamente se discava 0 + DDD (017, 011),
  //    e muita gente digita assim até hoje. Com o DDI junto vira
  //    55 + 017 + número — um telefone de 14 dígitos que não existe.
  //    Tira o zero e confere de novo. Sem ambiguidade possível: DDD 50
  //    não existe, então nenhum número válido começa com 550.
  //    (O zero puro no INÍCIO — 017 sem DDI — já foi tirado lá em cima.)
  if (d.startsWith("550")) {
    const semZero = "55" + d.slice(3);
    if (ehBrasileiroComDDI(semZero)) return semZero;
  }

  const iso = (pais ?? "").trim().toUpperCase();
  const ddi = DDI[iso];

  // 4) Não tem cara de brasileiro. Se sabemos de onde veio a compra e o
  //    número ainda não traz o código do país, completa com o de lá.
  //    Só em número curto: com 12 dígitos ou mais ele já traz o dele, e
  //    colar outro na frente inventa um telefone que não existe.
  if (ddi && iso !== "BR" && !d.startsWith(ddi) && d.length >= 8 && d.length <= 11) {
    return ddi + d;
  }

  // 5) Número estrangeiro que já vem completo, ou origem desconhecida:
  //    guarda como veio. Curto demais para ser telefone, descarta.
  return d.length >= 10 ? d : null;
}
