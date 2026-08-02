#!/usr/bin/env bash
# ============================================================
# RESSOA — instalador de 1 comando.
#   ./instalar.sh              instala tudo
#   ./instalar.sh --so-banco   só cria/atualiza o banco
#   ./instalar.sh --so-painel  só publica o painel
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

verde() { printf "\033[32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[33m%s\033[0m\n" "$1"; }
vermelho() { printf "\033[31m%s\033[0m\n" "$1"; }
passo() { printf "\n\033[35m▶ %s\033[0m\n" "$1"; }

# ---------- 1. checagens ----------
passo "1/6 Conferindo o ambiente"
command -v node >/dev/null || { vermelho "Node não encontrado. Instale o Node 20+: https://nodejs.org"; exit 1; }
command -v python >/dev/null || command -v python3 >/dev/null || { vermelho "Python não encontrado. Instale o Python 3.10+"; exit 1; }
PY=$(command -v python || command -v python3)
verde "  Node $(node -v) e Python OK"

[ -f .env ] || { vermelho "Falta o arquivo .env. Rode: cp .env.example .env  — e preencha as chaves."; exit 1; }
set -a; source .env; set +a

faltando=""
for v in SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_URL SUPABASE_ANON_KEY; do
  [ -n "${!v:-}" ] && [[ "${!v}" != *xxxx* ]] || faltando="$faltando $v"
done
[ -z "$faltando" ] || { vermelho "Preencha no .env:$faltando"; exit 1; }
verde "  .env preenchido"

SO_BANCO=false; SO_PAINEL=false
[ "${1:-}" = "--so-banco" ] && SO_BANCO=true
[ "${1:-}" = "--so-painel" ] && SO_PAINEL=true

# ---------- 2. banco ----------
if [ "$SO_PAINEL" = false ]; then
  # Nao entram aqui, de proposito:
  #   corrige_*.sql   consertos pontuais de uma migracao especifica
  #   regras_*.sql    regras dos produtos de uma operacao especifica
  #   teste_*.sql     provas do motor, para rodar a mao quando quiser
  passo "2/6 Criando o banco (tabelas, funções, permissões e agendamentos)"
  for sql in \
    supabase/replica_base.sql \
    supabase/motor_v1.sql supabase/motor_v1_1.sql supabase/motor_v2.sql \
    supabase/motor_v3.sql supabase/motor_v3_1.sql \
    supabase/motor_v4_descadastro.sql supabase/motor_v5_ses.sql \
    supabase/auth_v1.sql supabase/auth_v2_admin_mestre.sql supabase/auth_v3_lista_mestres.sql \
    supabase/auth_v4_minha_conta.sql supabase/auth_v5_perfil.sql \
    supabase/auth_v6_troca_email.sql supabase/auth_v7_codigos.sql \
    supabase/papeis_v2.sql supabase/contagens.sql \
    supabase/motor_v6_clique_preheader.sql \
    supabase/motor_v7_rodape.sql \
    supabase/motor_v8_resposta.sql \
    supabase/motor_v9_integracoes.sql \
    supabase/corrige_status_execucoes.sql \
    supabase/corrige_passo_inicial.sql \
    supabase/motor_v11_gatilhos.sql \
    supabase/motor_v3_2_pontuacao.sql \
    supabase/supressao_v2.sql \
    supabase/ficha_lead_v2.sql \
    supabase/operacoes_dados.sql \
    supabase/gestao_v1.sql \
    supabase/motor_v10_campos.sql \
    supabase/campos_do_ac.sql \
    supabase/pontuacao_v1.sql \
    supabase/pontuacao_v1_1.sql \
    supabase/pontuacao_v1_2.sql \
    supabase/formularios_v1.sql \
    supabase/formularios_v1_1.sql \
    supabase/formularios_v1_2.sql \
    supabase/relatorios_v1.sql \n    supabase/vendas_v1.sql \n    supabase/motor_v3_3_compras.sql \n    supabase/pontuacao_v1_3_vendas.sql \n    supabase/hotmart_v1.sql \n    supabase/hotmart_v1_1.sql \n    supabase/hotmart_v1_2.sql \n    supabase/hotmart_v2.sql \n    supabase/hotmart_v2_1.sql \n    supabase/atribuicao_v1.sql \n    supabase/atribuicao_v2.sql \n    supabase/turmas_v1.sql \n    supabase/imagens_v1.sql
  do
    printf "  → %s\n" "$(basename "$sql")"
    "$PY" scripts/run_sql_file.py "$sql" >/dev/null || { vermelho "  falhou em $sql"; exit 1; }
  done
  verde "  Banco pronto"
fi

# ---------- 3. dependências do painel ----------
if [ "$SO_BANCO" = false ]; then
  passo "3/6 Instalando as dependências do painel"
  npm --prefix app/painel install --silent
  verde "  Dependências instaladas"

  passo "4/6 Gerando o arquivo de configuração do painel"
  cat > app/painel/.env.local <<EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF
  verde "  app/painel/.env.local criado"

  # ---------- 4. Edge Functions ----------
  passo "5/6 Publicando as Edge Functions"
  mkdir -p app/supabase/functions
  cp -r app/functions/* app/supabase/functions/
  export SUPABASE_ACCESS_TOKEN
  if [ -n "${RESSOA_EMAIL_WEBHOOK:-}" ] && [ -n "${RESSOA_EMAIL_SEGREDO:-}" ]; then
    (cd app && npx --yes supabase secrets set \
        RESSOA_EMAIL_WEBHOOK="$RESSOA_EMAIL_WEBHOOK" \
        RESSOA_EMAIL_SEGREDO="$RESSOA_EMAIL_SEGREDO" \
        --project-ref "$SUPABASE_PROJECT_REF" >/dev/null) && verde "  Segredos do canal de e-mail configurados"
  else
    amarelo "  (canal transacional não configurado — códigos de segurança não serão enviados)"
  fi
  if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    (cd app && npx --yes supabase secrets set \
        AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
        AWS_REGIAO="${AWS_REGIAO:-us-east-1}" \
        SES_SEGREDO="${SES_SEGREDO:-}" \
        --project-ref "$SUPABASE_PROJECT_REF" >/dev/null) && verde "  Credenciais do Amazon SES configuradas"
  fi
  for f in rastreio descadastro formulario postback-resend conta-email enviar-ses postback-ses venda; do
    printf "  → %s\n" "$f"
    (cd app && npx --yes supabase functions deploy "$f" \
        --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt --use-api >/dev/null)
  done
  verde "  7 funções publicadas"

  # ---------- 5. painel ----------
  passo "6/6 Publicando o painel"
  npm --prefix app/painel run build --silent
  if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [[ "$CLOUDFLARE_ACCOUNT_ID" != *xxxx* ]]; then
    export CLOUDFLARE_ACCOUNT_ID
    npx --yes wrangler pages project create ressoa --production-branch main 2>/dev/null || true
    npx --yes wrangler pages deploy app/painel/dist --project-name ressoa --branch main --commit-dirty=true
    verde "  Painel publicado"
  else
    amarelo "  CLOUDFLARE_ACCOUNT_ID não preenchido — pulei a publicação."
    amarelo "  Para rodar local: npm --prefix app/painel run dev"
  fi
fi

# ---------- pronto ----------
cat <<'FIM'

============================================================
  RESSOA INSTALADO
============================================================

O QUE FAZER AGORA

1) CRIAR O PRIMEIRO ADMIN
   Abra o painel, clique em "Criar conta" e cadastre-se.
   Depois libere a conta rodando no SQL Editor do Supabase:

     update public.usuarios_ressoa
     set papel = 'admin', status = 'aprovado'
     where email = 'SEU@EMAIL.COM';

   (E-mails listados em public.admins_permanentes já nascem admin.)

2) DOMÍNIO PRÓPRIO (opcional)
   No Cloudflare Pages > seu projeto > Custom domains, adicione o
   subdomínio e crie o CNAME apontando para <projeto>.pages.dev.
   Depois registre a URL em: Supabase > Authentication > URL Configuration.

3) ENVIO REAL
   O sistema começa em MODO SIMULADO: processa tudo, mas nenhum e-mail sai.
   Para ligar de verdade, siga docs/05-LIGAR-ENVIO-REAL.md

4) TRAZER SUA BASE DO ACTIVECAMPAIGN
   Siga docs/03-MIGRAR-DO-ACTIVECAMPAIGN.md

Documentação completa: pasta docs/
FIM
