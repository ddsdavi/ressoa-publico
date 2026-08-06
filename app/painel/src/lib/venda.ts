// O eixo de venda é outro eixo: vendas é uma coisa, engajamento com e-mail é
// outra. Cada jogada é um pedaço da esteira, com os números que a justificam
// medidos no próprio histórico (ago/2025–ago/2026). Estes textos aparecem em
// Relatórios → Prontos pra comprar, na página Leads e no construtor de
// segmentos — por isso moram aqui, num lugar só.

export const JOGADAS: Record<string, { titulo: string; quem: string; porque: string }> = {
  formacao_janela_quente: {
    titulo: "Formação — janela quente",
    quem: "Comprou um produto de entrada há até 30 dias e ainda não tem a Formação.",
    porque: "79% dos alunos da Formação compraram um produto de entrada antes, e a conversão típica acontece 6 a 11 dias depois da compra. É a jogada que mais paga por e-mail enviado.",
  },
  formacao_segunda_chamada: {
    titulo: "Formação — segunda chamada",
    quem: "Compra de entrada entre 30 e 90 dias, ainda sem a Formação.",
    porque: "O público ainda está morno: é onde funcionam condição especial, bônus e depoimento de aluno.",
  },
  alumni_black_acomp: {
    titulo: "Aluno → Black / Acompanhamento",
    quem: "Tem a Formação e não tem Black nem Acompanhamento.",
    porque: "Só 21 dos 163 compradores da Black eram alunos da Formação — a prateleira de cima está mal oferecida justamente para quem mais confia no trabalho.",
  },
  desafio_lives: {
    titulo: "Lives → Desafio",
    quem: "Ativo na lista das Lives Semanais e nunca comprou nada.",
    porque: "Aparece toda semana de graça; o Desafio é o degrau natural entre assistir e comprar.",
  },
  desafio_novos: {
    titulo: "Novos → Desafio",
    quem: "Entrou na base há até 90 dias e ainda não comprou.",
    porque: "Lead novo ainda lembra de onde veio — a porta de entrada converte enquanto a memória está fresca.",
  },
  reativar_esteira: {
    titulo: "Reativar a esteira",
    quem: "Já comprou, mas a última compra passou de 90 dias.",
    porque: "Comprador esfriando: novo ciclo do Desafio ou oferta de retorno, antes de virar contato frio.",
  },
  vip_relacionamento: {
    titulo: "VIP — relacionamento",
    quem: "Já tem o topo da esteira (Formação + Black ou Acompanhamento).",
    porque: "Cliente de maior valor. Relacionamento, novidade em primeira mão e pedido de indicação — não oferta agressiva.",
  },
  aquecer_primeiro: {
    titulo: "Aquecer primeiro",
    quem: "Sem compra e sem sinal recente.",
    porque: "Oferta agora queima o domínio. Conteúdo e lives primeiro; aqui a jogada é reengajar, não vender.",
  },
  tratar_reembolso: {
    titulo: "Fora de oferta",
    quem: "Pediu reembolso e não voltou a comprar.",
    porque: "Não entra em campanha de venda. Se voltar a comprar, sai desta lista sozinho.",
  },
};

export const ORDEM_JOGADAS = [
  "formacao_janela_quente", "formacao_segunda_chamada", "alumni_black_acomp",
  "desafio_lives", "desafio_novos", "reativar_esteira",
  "vip_relacionamento", "aquecer_primeiro", "tratar_reembolso",
];

export const FAIXAS_VENDA: Record<string, { rotulo: string; classe: string }> = {
  prontissimo: { rotulo: "Prontíssimo", classe: "et-verde" },
  pronto: { rotulo: "Pronto", classe: "et-roxa" },
  aquecendo: { rotulo: "Aquecendo", classe: "et-amarela" },
  frio: { rotulo: "Frio", classe: "et-cinza" },
};
