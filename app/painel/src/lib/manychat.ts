import { supabase } from "./supabase";

const FUNCAO_MANYCHAT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manychat`;
const CHAVE_PUBLICA = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export type ManyChatTag = { id: number; name: string };

export type ManyChatAssinante = {
  id: number;
  nome: string;
  status: string;
  whatsapp: string;
  tags: string[];
};

export async function chamarManyChat(corpo: Record<string, unknown>) {
  const { data: sessao } = await supabase.auth.getSession();
  const resposta = await fetch(FUNCAO_MANYCHAT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CHAVE_PUBLICA,
      Authorization: `Bearer ${sessao.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(corpo),
  });

  const texto = await resposta.text();
  let dados: Record<string, any> = {};
  try {
    dados = JSON.parse(texto);
  } catch {
    dados = { ok: false, erro: texto || `erro ${resposta.status}` };
  }
  if (!resposta.ok && dados.ok !== false) dados.ok = false;
  return dados;
}
