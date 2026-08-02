# -*- coding: utf-8 -*-
"""Atualiza a interface para o papel novo: Assistente PREPARA, mas NÃO DISPARA."""
import io, os

BASE = r"D:\1. CLAUDE DS.DAVI.OFICIAL\ACTIVE DAVI DAMASCENO\app\painel\src"
def ler(p):  return io.open(os.path.join(BASE, p), encoding="utf-8").read()
def esc(p, t): io.open(os.path.join(BASE, p), "w", encoding="utf-8").write(t)

# ---------- papeis.ts ----------
esc("lib/papeis.ts", '''// Rótulos neutros de gênero — servem para qualquer pessoa da equipe.
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
''')
print("papeis.ts")

# ---------- sessao.tsx ----------
t = ler("lib/sessao.tsx")
t = t.replace("  podeOperar: boolean;   // admin ou terapeuta",
              "  podeOperar: boolean;    // admin ou terapeuta — dispara e mexe no motor\n"
              "  podePreparar: boolean;  // + assistente — cria e edita a operação")
t = t.replace('      podeOperar: papel === "admin" || papel === "terapeuta",',
              '      podeOperar: papel === "admin" || papel === "terapeuta",\n'
              '      podePreparar: papel === "admin" || papel === "terapeuta" || papel === "assistente",')
esc("lib/sessao.tsx", t)
print("sessao.tsx")

# ---------- Leads ----------
t = ler("pages/Leads.tsx")
t = t.replace("const { podeOperar } = useSessao();", "const { podeOperar, podePreparar } = useSessao();")
t = t.replace("""          {podeOperar && <>
            <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => setCriando(!criando)}>+ Novo lead</button>""",
              """          {podePreparar && <>
            <button className="primario" style={{ flex: "0 0 auto" }} onClick={() => setCriando(!criando)}>+ Novo lead</button>""")
esc("pages/Leads.tsx", t)
print("Leads.tsx")

# ---------- Listas e Tags ----------
for arq in ("pages/Listas.tsx", "pages/Tags.tsx"):
    t = ler(arq)
    t = t.replace("const { podeOperar } = useSessao();", "const { podePreparar } = useSessao();")
    t = t.replace("{podeOperar && (", "{podePreparar && (").replace("{podeOperar && <>", "{podePreparar && <>")
    esc(arq, t)
print("Listas.tsx e Tags.tsx")

# ---------- Campanhas ----------
t = ler("pages/Campanhas.tsx")
if "useSessao" not in t:
    t = t.replace('import { supabase } from "../lib/supabase";',
                  'import { supabase } from "../lib/supabase";\nimport { useSessao } from "../lib/sessao";')
    t = t.replace("export default function Campanhas() {",
                  "export default function Campanhas() {\n  const { podeOperar } = useSessao();")
t = t.replace("""              <button className="primario" disabled={ocupado} onClick={() => criar(true)}>Disparar agora</button>""",
              """              {podeOperar
                ? <button className="primario" disabled={ocupado} onClick={() => criar(true)}>Disparar agora</button>
                : <span className="sub" style={{ flex: "0 0 auto", margin: 0 }}>Quem dispara é a Terapeuta ou a Admin.</span>}""")
t = t.replace("""                  {(c.status === "draft" || c.status === "scheduled") &&
                    <button onClick={() => dispararExistente(c.campanha_id)}>Disparar</button>}""",
              """                  {podeOperar && (c.status === "draft" || c.status === "scheduled") &&
                    <button onClick={() => dispararExistente(c.campanha_id)}>Disparar</button>}""")
esc("pages/Campanhas.tsx", t)
print("Campanhas.tsx")

# ---------- Tour ----------
t = ler("components/Tour.tsx")
t = t.replace("""      { nome: "Terapeuta", descricao: "MEXE na operação: cria leads, listas, tags, mensagens e campanhas — e dispara e-mail." },
      { nome: "Assistente", descricao: "SÓ OLHA: consulta leads, campanhas e relatórios. Não cria, não edita, não dispara." },
      { nome: "Admin", descricao: "faz tudo o que a Terapeuta faz + configurações, API/webhooks e liberação de usuários." },""",
"""      { nome: "Assistente", descricao: "PREPARA: cria leads, listas, tags e monta a campanha em rascunho. Não dispara e-mail nem exporta a base." },
      { nome: "Terapeuta", descricao: "PREPARA E DISPARA: faz tudo da operação e é quem envia a campanha de verdade." },
      { nome: "Admin", descricao: "tudo isso + configurações, API/webhooks e liberação de usuários." },""")
t = t.replace('dica: "Essas regras valem no banco de dados: ninguém contorna o próprio nível, nem por fora do sistema.",',
              'dica: "A lógica: quem prepara não precisa ser quem aperta enviar — disparo para milhares de pessoas não tem desfazer. E as regras valem no banco: ninguém contorna o próprio nível, nem por fora do sistema.",')
t = t.replace('texto: "Aqui você vê todo mundo cadastrado, libera quem acabou de se inscrever e define se a pessoa é Admin, Terapeuta ou Assistente. Também tem o registro de segurança.",',
              'texto: "Aqui você vê todo mundo cadastrado, libera quem acabou de se inscrever e define o nível de cada pessoa. Tem uma tabela mostrando exatamente o que cada nível pode fazer, além do registro de segurança.",')
alvo = """    id: "campanhas", rota: "/campanhas", sel: ".ac-sidebar a[href='/campanhas']", emoji: "\U0001F4E3", titulo: "Campanhas",
    texto: "É o disparo pontual: escolhe a mensagem, escolhe quem recebe (listas ou um segmento salvo) e envia ou agenda. Depois, o relatório mostra quem abriu e quem clicou em cada link.","""
novo = alvo + """
    dica: "Assistente monta a campanha e deixa em rascunho; o disparo fica com a Terapeuta ou a Admin.","""
t = t.replace(alvo, novo)

# passo novo de Listas e Tags, antes do de campanhas
marca = """  {
    id: "campanhas","""
passo_novo = """  {
    id: "listas-tags", rota: "/listas", sel: ".ac-sidebar a[href='/listas']", emoji: "\U0001F5C2\uFE0F", titulo: "Listas e Tags",
    texto: "Listas s\u00e3o os p\u00fablicos e eventos — \u00e9 para elas que a campanha vai. Tags s\u00e3o marcadores que voc\u00ea aplica nas pessoas. Clique no nome ou na quantidade para ver os leads de cada uma.",
    dica: "Entrar numa lista ou ganhar uma tag \u00e9 justamente o que dispara as automa\u00e7\u00f5es.",
  },
  {
    id: "campanhas","""
t = t.replace(marca, passo_novo, 1)
esc("components/Tour.tsx", t)
print("Tour.tsx")
