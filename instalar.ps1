# ============================================================
# RESSOA — instalador de 1 comando (Windows)
#   .\instalar.ps1              instala tudo
#   .\instalar.ps1 -SoBanco     só cria/atualiza o banco
#   .\instalar.ps1 -SoPainel    só publica o painel
# ============================================================
param([switch]$SoBanco, [switch]$SoPainel)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Passo($t) { Write-Host "`n> $t" -ForegroundColor Magenta }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  $t" -ForegroundColor Yellow }
function Erro($t)  { Write-Host $t -ForegroundColor Red; exit 1 }

# ---------- 1. checagens ----------
Passo "1/6 Conferindo o ambiente"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Erro "Node nao encontrado. Instale o Node 20+: https://nodejs.org" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Erro "Python nao encontrado. Instale o Python 3.10+" }
Ok "Node $(node -v) e Python OK"

if (-not (Test-Path .env)) { Erro "Falta o arquivo .env. Rode: copy .env.example .env  — e preencha as chaves." }
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
  }
}
$faltando = @()
foreach ($v in @("SUPABASE_PROJECT_REF","SUPABASE_ACCESS_TOKEN","SUPABASE_URL","SUPABASE_ANON_KEY")) {
  $valor = [Environment]::GetEnvironmentVariable($v, "Process")
  if (-not $valor -or $valor -like "*xxxx*") { $faltando += $v }
}
if ($faltando.Count -gt 0) { Erro ("Preencha no .env: " + ($faltando -join ", ")) }
Ok ".env preenchido"

# ---------- 2. banco ----------
if (-not $SoPainel) {
  # Nao entram aqui, de proposito: corrige_* (consertos de uma migracao
  # especifica), regras_* (produtos de uma operacao especifica) e teste_*
  Passo "2/6 Criando o banco (tabelas, funcoes, permissoes e agendamentos)"
  $sqls = @(
    "supabase/replica_base.sql",
    "supabase/motor_v1.sql","supabase/motor_v1_1.sql","supabase/motor_v2.sql",
    "supabase/motor_v3.sql","supabase/motor_v3_1.sql",
    "supabase/motor_v4_descadastro.sql","supabase/motor_v5_ses.sql",
    "supabase/auth_v1.sql","supabase/auth_v2_admin_mestre.sql","supabase/auth_v3_lista_mestres.sql",
    "supabase/auth_v4_minha_conta.sql","supabase/auth_v5_perfil.sql",
    "supabase/auth_v6_troca_email.sql","supabase/auth_v7_codigos.sql",
    "supabase/papeis_v2.sql","supabase/contagens.sql",
    "supabase/motor_v6_clique_preheader.sql","supabase/motor_v7_rodape.sql",
    "supabase/motor_v8_resposta.sql","supabase/motor_v9_integracoes.sql",
    "supabase/corrige_status_execucoes.sql","supabase/corrige_passo_inicial.sql",
    "supabase/motor_v11_gatilhos.sql","supabase/motor_v3_2_pontuacao.sql",
    "supabase/supressao_v2.sql","supabase/ficha_lead_v2.sql","supabase/operacoes_dados.sql",
    "supabase/gestao_v1.sql","supabase/motor_v10_campos.sql","supabase/campos_do_ac.sql",
    "supabase/pontuacao_v1.sql","supabase/pontuacao_v1_1.sql","supabase/pontuacao_v1_2.sql",
    "supabase/formularios_v1.sql","supabase/formularios_v1_1.sql","supabase/formularios_v1_2.sql",
    "supabase/relatorios_v1.sql",
    "supabase/vendas_v1.sql","supabase/motor_v3_3_compras.sql",
    "supabase/pontuacao_v1_3_vendas.sql",
    "supabase/hotmart_v1.sql","supabase/hotmart_v1_1.sql","supabase/hotmart_v1_2.sql","supabase/hotmart_v2.sql","supabase/hotmart_v2_1.sql",
    "supabase/atribuicao_v1.sql","supabase/atribuicao_v2.sql","supabase/turmas_v1.sql","supabase/imagens_v1.sql",
    "supabase/recuperacao_v1.sql","supabase/contexto_rss_v1.sql","supabase/rss_cron_v1.sql","supabase/segredos_v1.sql",
    "supabase/listas_produtos_v1.sql","supabase/listas_produtos_v1_1.sql","supabase/campanhas_v2_tipos.sql","supabase/gatilho_data_v1.sql","supabase/trava_envio_v1.sql"
  )
  foreach ($sql in $sqls) {
    Write-Host "  -> $(Split-Path $sql -Leaf)"
    python scripts/run_sql_file.py $sql | Out-Null
    if ($LASTEXITCODE -ne 0) { Erro "  falhou em $sql" }
  }
  Ok "Banco pronto"
}

if (-not $SoBanco) {
  # ---------- 3. painel ----------
  Passo "3/6 Instalando as dependencias do painel"
  npm --prefix app/painel install --silent
  Ok "Dependencias instaladas"

  Passo "4/6 Gerando o arquivo de configuracao do painel"
  @(
    "VITE_SUPABASE_URL=$env:SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY=$env:SUPABASE_ANON_KEY"
  ) | Out-File -FilePath "app/painel/.env.local" -Encoding utf8
  Ok "app/painel/.env.local criado"

  # ---------- 4. Edge Functions ----------
  Passo "5/6 Publicando as Edge Functions"
  New-Item -ItemType Directory -Force "app/supabase/functions" | Out-Null
  Copy-Item "app/functions/*" "app/supabase/functions/" -Recurse -Force
  if ($env:RESSOA_EMAIL_WEBHOOK -and $env:RESSOA_EMAIL_SEGREDO) {
    Push-Location app
    npx --yes supabase secrets set "RESSOA_EMAIL_WEBHOOK=$env:RESSOA_EMAIL_WEBHOOK" "RESSOA_EMAIL_SEGREDO=$env:RESSOA_EMAIL_SEGREDO" --project-ref $env:SUPABASE_PROJECT_REF | Out-Null
    Pop-Location
    Ok "Segredos do canal de e-mail configurados"
  } else {
    Aviso "(canal transacional nao configurado — codigos de seguranca nao serao enviados)"
  }
  if ($env:AWS_ACCESS_KEY_ID -and $env:AWS_SECRET_ACCESS_KEY) {
    $regiao = if ($env:AWS_REGIAO) { $env:AWS_REGIAO } else { "us-east-1" }
    Push-Location app
    npx --yes supabase secrets set "AWS_ACCESS_KEY_ID=$($env:AWS_ACCESS_KEY_ID)" `
      "AWS_SECRET_ACCESS_KEY=$($env:AWS_SECRET_ACCESS_KEY)" "AWS_REGIAO=$regiao" `
      "SES_SEGREDO=$($env:SES_SEGREDO)" --project-ref $env:SUPABASE_PROJECT_REF | Out-Null
    Pop-Location
    Write-Host "  Credenciais do Amazon SES configuradas" -ForegroundColor Green
  }
  # A lista sai do proprio diretorio: funcao nova entra sozinha.
  $funcoes = Get-ChildItem -Directory app/functions | ForEach-Object { $_.Name }
  foreach ($f in $funcoes) {
    Write-Host "  -> $f"
    Push-Location app
    npx --yes supabase functions deploy $f --project-ref $env:SUPABASE_PROJECT_REF --no-verify-jwt --use-api | Out-Null
    Pop-Location
  }
  Ok "  $($funcoes.Count) funcoes publicadas"

  # ---------- 5. publicar ----------
  Passo "6/6 Publicando o painel"
  npm --prefix app/painel run build --silent
  if ($env:CLOUDFLARE_ACCOUNT_ID -and $env:CLOUDFLARE_ACCOUNT_ID -notlike "*xxxx*") {
    npx --yes wrangler pages project create ressoa --production-branch main 2>$null
    npx --yes wrangler pages deploy app/painel/dist --project-name ressoa --branch main --commit-dirty=true
    Ok "Painel publicado"
  } else {
    Aviso "CLOUDFLARE_ACCOUNT_ID nao preenchido — pulei a publicacao."
    Aviso "Para rodar local: npm --prefix app/painel run dev"
  }
}

Write-Host @"

============================================================
  RESSOA INSTALADO
============================================================

O QUE FAZER AGORA

1) CRIAR O PRIMEIRO ADMIN
   Abra o painel, clique em "Criar conta" e cadastre-se.
   Depois libere a conta no SQL Editor do Supabase:

     update public.usuarios_ressoa
     set papel = 'admin', status = 'aprovado'
     where email = 'SEU@EMAIL.COM';

2) DOMINIO PROPRIO (opcional)
   Cloudflare Pages > projeto > Custom domains + CNAME para <projeto>.pages.dev
   Depois registre a URL em Supabase > Authentication > URL Configuration.

3) ENVIO REAL
   O sistema comeca em MODO SIMULADO. Para ligar: docs/05-LIGAR-ENVIO-REAL.md

4) TRAZER SUA BASE DO ACTIVECAMPAIGN
   Siga docs/03-MIGRAR-DO-ACTIVECAMPAIGN.md

Documentacao completa: pasta docs/
"@ -ForegroundColor Cyan
