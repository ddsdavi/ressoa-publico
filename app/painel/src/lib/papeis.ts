// Rótulos neutros de gênero — servem para qualquer pessoa da equipe.
export const ROTULO_PAPEL: Record<string, string> = {
  admin: "Admin",
  terapeuta: "Terapeuta",
  assistente: "Assistente",
};

export const DESCRICAO_PAPEL: Record<string, string> = {
  admin: "Tudo o que a Terapeuta faz + configurações, API/webhooks e gestão de usuários.",
  terapeuta: "PREPARA E DISPARA: faz tudo da operação e é quem envia a campanha de verdade.",
  assistente: "PREPARA, MAS NÃO DISPARA: monta leads, listas, tags e campanhas em rascunho — quem envia é a Terapeuta ou a Admin.",
};

// Comparativo exibido na tela de Usuários
export const PODE: { acao: string; admin: boolean; terapeuta: boolean; assistente: boolean }[] = [
  { acao: "Ver leads, listas, tags, campanhas e relatórios", admin: true, terapeuta: true, assistente: true },
  { acao: "Criar e editar leads", admin: true, terapeuta: true, assistente: true },
  { acao: "Criar e editar listas e tags", admin: true, terapeuta: true, assistente: true },
  { acao: "Importar leads por CSV", admin: true, terapeuta: true, assistente: true },
  { acao: "Escrever mensagens e montar campanha (rascunho)", admin: true, terapeuta: true, assistente: true },
  { acao: "DISPARAR campanha (o e-mail sai de verdade)", admin: true, terapeuta: true, assistente: false },
  { acao: "Criar e ligar/desligar automações", admin: true, terapeuta: true, assistente: false },
  { acao: "Exportar a base em CSV", admin: true, terapeuta: true, assistente: false },
  { acao: "Mexer na supressão (quem nunca recebe)", admin: true, terapeuta: true, assistente: false },
  { acao: "Configurações, API e webhooks", admin: true, terapeuta: false, assistente: false },
  { acao: "Liberar cadastros e definir níveis de acesso", admin: true, terapeuta: false, assistente: false },
];
