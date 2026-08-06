import type { CSSProperties } from "react";

// Campo de segredo: chave de API, client secret, frase interna.
//
// Aqui NÃO se usa type="password". Para o Chrome, todo type="password" é a
// senha de um login: a cada vez que alguém digitava a chave do ManyChat, ele
// abria o "Atualizar senha?" oferecendo guardar a chave no Gerenciador de
// Senhas do Google, emparelhada com o e-mail de acesso ao painel. Errado das
// duas pontas — a chave não é senha de ninguém, e um "Atualizar senha" aceito
// no automático estraga a senha de verdade que estava salva ali.
//
// Não existe atributo que desligue esse convite: o Chrome ignora
// autocomplete="off" em campo de senha de propósito, para que nenhum site
// possa atrapalhar o gerenciador. O que sobra é a tela não ter campo de senha
// nenhum — e essas telas de configuração não têm senha, têm segredo.
//
// A tarja continua: quem esconde o texto é o CSS (.segredo), não o tipo do
// campo. Em navegador que não conhece -webkit-text-security a máscara não
// pegaria, e chave de API à mostra na tela de quem compartilha janela é pior
// do que convite chato — nesse caso, e só nesse, voltamos para o campo de
// senha.
const MASCARA_POR_CSS =
  typeof CSS !== "undefined" && CSS.supports("-webkit-text-security", "disc");

export default function CampoSegredo({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  style?: CSSProperties;
}) {
  return (
    <input
      type={MASCARA_POR_CSS ? "text" : "password"}
      className={MASCARA_POR_CSS ? "segredo" : undefined}
      value={value}
      placeholder={placeholder}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      // Fora o do Chrome, os gerenciadores de senha de fora (1Password,
      // LastPass, Bitwarden) caçam campo a campo e enfiam o ícone deles dentro
      // da caixa; cada um respeita a marca própria. E nada de corretor
      // ortográfico: chave aleatória sublinhada de vermelho não ajuda ninguém.
      autoComplete="off"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      data-1p-ignore
      data-lpignore="true"
      data-bwignore
      data-form-type="other"
    />
  );
}
