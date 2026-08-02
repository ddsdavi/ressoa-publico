// Edge Function pública: contador regressivo como IMAGEM.
//
//   GET /contador?ate=2026-08-10T07:00:00-03:00&cor=6b4ea8&fundo=ffffff
//
// Por que imagem: cliente de e-mail não executa JavaScript. Um contador
// só funciona se for uma figura, e ela é pedida de novo a cada abertura —
// então o tempo mostrado é o do momento em que a pessoa abriu, não o do
// momento em que o e-mail foi enviado.
//
// O PNG é montado à mão, sem biblioteca: os dígitos são desenhados como
// retângulos (mesmo princípio de um display de sete segmentos) num buffer
// de pixels, que depois é comprimido e assinado no formato PNG. Não há
// dependência para instalar, nem serviço externo para depender.

const enc = new TextEncoder();

// ---------- PNG cru ----------
const CRC: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function bloco(tipo: string, dados: Uint8Array): Uint8Array {
  const t = enc.encode(tipo);
  const corpo = new Uint8Array(t.length + dados.length);
  corpo.set(t); corpo.set(dados, t.length);
  const saida = new Uint8Array(4 + corpo.length + 4);
  saida.set(be(dados.length)); saida.set(corpo, 4);
  saida.set(be(crc32(corpo)), 4 + corpo.length);
  return saida;
}

async function png(largura: number, altura: number, pixels: Uint8Array): Promise<Uint8Array> {
  // uma linha de filtro 0 antes de cada linha de pixels, como o formato pede
  const cru = new Uint8Array((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    cru[y * (largura * 3 + 1)] = 0;
    cru.set(pixels.subarray(y * largura * 3, (y + 1) * largura * 3),
            y * (largura * 3 + 1) + 1);
  }
  const comprimido = new Uint8Array(await new Response(
    new Blob([cru]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());

  const ihdr = new Uint8Array(13);
  ihdr.set(be(largura)); ihdr.set(be(altura), 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8 bits, RGB

  const partes = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco("IHDR", ihdr), bloco("IDAT", comprimido), bloco("IEND", new Uint8Array(0)),
  ];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- desenho ----------
// cada dígito em 7 segmentos: cima, cima-esq, cima-dir, meio, baixo-esq,
// baixo-dir, baixo
const SEG: Record<string, number[]> = {
  "0": [1, 1, 1, 0, 1, 1, 1], "1": [0, 0, 1, 0, 0, 1, 0], "2": [1, 0, 1, 1, 1, 0, 1],
  "3": [1, 0, 1, 1, 0, 1, 1], "4": [0, 1, 1, 1, 0, 1, 0], "5": [1, 1, 0, 1, 0, 1, 1],
  "6": [1, 1, 0, 1, 1, 1, 1], "7": [1, 0, 1, 0, 0, 1, 0], "8": [1, 1, 1, 1, 1, 1, 1],
  "9": [1, 1, 1, 1, 0, 1, 1],
};

type Tela = { w: number; h: number; px: Uint8Array };

function pintar(t: Tela, x: number, y: number, w: number, h: number, c: number[]) {
  for (let j = Math.max(0, y); j < Math.min(t.h, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(t.w, x + w); i++) {
      const p = (j * t.w + i) * 3;
      t.px[p] = c[0]; t.px[p + 1] = c[1]; t.px[p + 2] = c[2];
    }
  }
}

function digito(t: Tela, d: string, x: number, y: number, alt: number, cor: number[]) {
  const s = SEG[d];
  if (!s) return;
  const esp = Math.max(2, Math.round(alt / 9));      // espessura do traço
  const larg = Math.round(alt * 0.56);
  const meio = y + Math.round(alt / 2) - Math.round(esp / 2);
  if (s[0]) pintar(t, x, y, larg, esp, cor);                              // cima
  if (s[1]) pintar(t, x, y, esp, Math.round(alt / 2), cor);               // cima-esq
  if (s[2]) pintar(t, x + larg - esp, y, esp, Math.round(alt / 2), cor);  // cima-dir
  if (s[3]) pintar(t, x, meio, larg, esp, cor);                           // meio
  if (s[4]) pintar(t, x, meio, esp, Math.round(alt / 2), cor);            // baixo-esq
  if (s[5]) pintar(t, x + larg - esp, meio, esp, Math.round(alt / 2), cor);
  if (s[6]) pintar(t, x, y + alt - esp, larg, esp, cor);                  // baixo
}

const hex = (s: string, padrao: number[]) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s ?? "");
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16),
              parseInt(m[1].slice(4, 6), 16)] : padrao;
};

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const ate = new Date(u.searchParams.get("ate") ?? "");
  const cor = hex(u.searchParams.get("cor") ?? "", [107, 78, 168]);
  const fundo = hex(u.searchParams.get("fundo") ?? "", [255, 255, 255]);

  const sem = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Content-Type": "image/png",
  };

  if (isNaN(ate.getTime())) {
    return new Response("informe ?ate=2026-08-10T07:00:00-03:00", { status: 400 });
  }

  let resta = Math.max(0, Math.floor((ate.getTime() - Date.now()) / 1000));
  const dd = Math.floor(resta / 86400); resta -= dd * 86400;
  const hh = Math.floor(resta / 3600);  resta -= hh * 3600;
  const mm = Math.floor(resta / 60);
  const ss = resta - mm * 60;

  // ---- monta a tela ----
  const alt = 56, esp = 14, larg = Math.round(alt * 0.56);
  const grupo = larg * 2 + 8;                    // dois dígitos
  const w = grupo * 4 + esp * 3 + 40;
  const h = alt + 46;
  const t: Tela = { w, h, px: new Uint8Array(w * h * 3) };
  for (let i = 0; i < w * h; i++) {
    t.px[i * 3] = fundo[0]; t.px[i * 3 + 1] = fundo[1]; t.px[i * 3 + 2] = fundo[2];
  }

  const par = (n: number) => String(Math.min(99, n)).padStart(2, "0");
  const valores = [par(dd), par(hh), par(mm), par(ss)];
  let x = 20;
  for (let g = 0; g < 4; g++) {
    digito(t, valores[g][0], x, 12, alt, cor);
    digito(t, valores[g][1], x + larg + 8, 12, alt, cor);
    // rótulo por baixo, em blocos (dias / horas / min / seg)
    const rot = [3, 4, 3, 3][g];
    for (let k = 0; k < rot; k++) {
      pintar(t, x + k * 9, alt + 22, 6, 4, cor);
    }
    if (g < 3) {                                  // dois pontos separando
      const cx = x + grupo + Math.round(esp / 2) - 3;
      pintar(t, cx, 12 + Math.round(alt * 0.28), 6, 6, cor);
      pintar(t, cx, 12 + Math.round(alt * 0.62), 6, 6, cor);
    }
    x += grupo + esp;
  }

  return new Response(await png(w, h, t.px), { headers: sem });
});
