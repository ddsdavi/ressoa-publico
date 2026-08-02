// Parser de CSV simples e tolerante: detecta delimitador (; , ou tab),
// respeita aspas duplas e retorna cabeçalho + linhas.
export function parseCsv(texto: string): { cabecalho: string[]; linhas: string[][] } {
  const semBom = texto.replace(/^﻿/, "");
  const primeiraLinha = semBom.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", ",", "\t"]
    .map((d) => ({ d, n: primeiraLinha.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const linhas: string[][] = [];
  let atual: string[] = [];
  let campo = "";
  let emAspas = false;

  for (let i = 0; i < semBom.length; i++) {
    const c = semBom[i];
    if (emAspas) {
      if (c === '"') {
        if (semBom[i + 1] === '"') { campo += '"'; i++; }
        else emAspas = false;
      } else campo += c;
    } else if (c === '"') {
      emAspas = true;
    } else if (c === delim) {
      atual.push(campo); campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && semBom[i + 1] === "\n") i++;
      atual.push(campo); campo = "";
      if (atual.some((v) => v.trim() !== "")) linhas.push(atual);
      atual = [];
    } else campo += c;
  }
  if (campo !== "" || atual.length) {
    atual.push(campo);
    if (atual.some((v) => v.trim() !== "")) linhas.push(atual);
  }

  const cabecalho = (linhas.shift() ?? []).map((h) => h.trim());
  return { cabecalho, linhas };
}

// tenta adivinhar o mapeamento pelas palavras do cabeçalho
export function adivinharColuna(cabecalho: string[], alvo: "email" | "nome" | "whatsapp" | "cpf"): number {
  const padroes: Record<string, RegExp> = {
    email: /e-?mail/i,
    nome: /nome|name|first/i,
    whatsapp: /whats|phone|telefone|celular|fone/i,
    cpf: /cpf|documento/i,
  };
  return cabecalho.findIndex((h) => padroes[alvo].test(h));
}
