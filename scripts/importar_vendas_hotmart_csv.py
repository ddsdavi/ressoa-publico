# -*- coding: utf-8 -*-
"""Converte o relatório de vendas da Hotmart para importar_vendas(jsonb).

O arquivo da Hotmart repete alguns nomes de coluna (por exemplo, "Moeda"),
então não pode ser lido com importadores que exigem cabeçalhos únicos.

Uso:
  python scripts/importar_vendas_hotmart_csv.py relatorio.csv \
    --saida import.sql --preflight-saida preflight.sql

Relatórios grandes podem ser divididos sem criar CSVs intermediários:
  python scripts/importar_vendas_hotmart_csv.py relatorio.csv \
    --inicio 0 --limite 500 --saida import-001.sql

O SQL gerado contém dados pessoais e deve ficar fora do repositório.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo


STATUS = {
    "aprovado": "aprovada",
    "aprovada": "aprovada",
    "completo": "aprovada",
    "completa": "aprovada",
    "reembolsado": "reembolsada",
    "reembolsada": "reembolsada",
    "parcialmente reembolsado": "parcialmente_reembolsada",
    "parcialmente reembolsada": "parcialmente_reembolsada",
    "chargeback": "chargeback",
    "protestado": "chargeback",
    "protestada": "chargeback",
    "cancelado": "cancelada",
    "cancelada": "cancelada",
    "expirado": "expirada",
    "expirada": "expirada",
    "aguardando pagamento": "pendente",
    "boleto impresso": "pendente",
    "pagamento atrasado": "pendente",
    "pendente": "pendente",
}

EVENTO_POR_STATUS = {
    "aprovada": "PURCHASE_COMPLETE",
    "reembolsada": "PURCHASE_REFUNDED",
    "parcialmente_reembolsada": "PURCHASE_REFUNDED",
    "chargeback": "PURCHASE_CHARGEBACK",
    "cancelada": "PURCHASE_CANCELED",
    "expirada": "PURCHASE_EXPIRED",
    "pendente": "PURCHASE_DELAYED",
}

FUSO_HOTMART = ZoneInfo("America/Sao_Paulo")


def normalizar(texto: str | None) -> str:
    base = unicodedata.normalize("NFKD", (texto or "").strip().lower())
    return " ".join("".join(c for c in base if not unicodedata.combining(c)).split())


def decimal_ou_zero(texto: str | None) -> str:
    bruto = (texto or "").strip().replace(" ", "")
    if not bruto:
        return "0"
    if "," in bruto and "." in bruto:
        bruto = bruto.replace(".", "").replace(",", ".")
    else:
        bruto = bruto.replace(",", ".")
    try:
        return format(Decimal(bruto), "f")
    except InvalidOperation as exc:
        raise ValueError(f"valor inválido no relatório: {texto!r}") from exc


def data_iso(texto: str | None) -> str:
    if not (texto or "").strip():
        raise ValueError("venda sem data")
    dt = datetime.strptime(texto.strip(), "%d/%m/%Y %H:%M:%S")
    return dt.replace(tzinfo=FUSO_HOTMART).isoformat()


def telefone(row: dict[str, str]) -> str | None:
    ddd = re.sub(r"\D", "", row.get("DDD", ""))
    numero = re.sub(r"\D", "", row.get("Telefone", ""))
    if not numero:
        return None
    if ddd and not numero.startswith(ddd):
        numero = ddd + numero
    return numero


def cabecalhos_unicos(cabecalhos: list[str]) -> list[str]:
    vistos: Counter[str] = Counter()
    saida: list[str] = []
    for nome in cabecalhos:
        vistos[nome] += 1
        saida.append(nome if vistos[nome] == 1 else f"{nome}_{vistos[nome]}")
    return saida


def ler_vendas(caminho: Path) -> tuple[list[dict[str, object]], Counter[str], datetime, datetime]:
    vendas: list[dict[str, object]] = []
    contagem_status: Counter[str] = Counter()
    menor_data: datetime | None = None
    maior_data: datetime | None = None
    transacoes: set[str] = set()

    with caminho.open("r", encoding="utf-8-sig", newline="") as arquivo:
        leitor_base = csv.reader(arquivo, delimiter=";")
        try:
            cabecalho = next(leitor_base)
        except StopIteration as exc:
            raise ValueError("CSV vazio") from exc
        nomes = cabecalhos_unicos(cabecalho)

        for numero_linha, valores in enumerate(leitor_base, start=2):
            if not any(v.strip() for v in valores):
                continue
            if len(valores) != len(nomes):
                raise ValueError(
                    f"linha {numero_linha}: {len(valores)} colunas; esperado {len(nomes)}"
                )
            row = dict(zip(nomes, valores))
            status_original = normalizar(row.get("Status"))
            status = STATUS.get(status_original)
            if status is None:
                raise ValueError(
                    f"linha {numero_linha}: status da Hotmart não reconhecido: {row.get('Status')!r}"
                )

            transacao = (row.get("Transação") or "").strip()
            if not transacao:
                raise ValueError(f"linha {numero_linha}: transação vazia")
            if transacao in transacoes:
                raise ValueError(f"linha {numero_linha}: transação duplicada no CSV")
            transacoes.add(transacao)

            data_texto = (row.get("Data de Confirmação") or "").strip() \
                or (row.get("Data de Venda") or "").strip()
            data = data_iso(data_texto)
            data_dt = datetime.fromisoformat(data)
            menor_data = data_dt if menor_data is None else min(menor_data, data_dt)
            maior_data = data_dt if maior_data is None else max(maior_data, data_dt)

            vendas.append({
                "email": (row.get("Email") or "").strip().lower() or None,
                "nome": (row.get("Nome") or "").strip() or None,
                "telefone": telefone(row),
                "codigo_transacao": transacao,
                "produto": (row.get("Nome do Produto") or "").strip() or "produto sem nome",
                "valor": decimal_ou_zero(row.get("Preço Total") or row.get("Preço do Produto")),
                "moeda": (row.get("Moeda de recebimento") or row.get("Moeda") or "BRL").strip(),
                "pagamento": (row.get("Tipo de Pagamento") or row.get("Meio de Pagamento") or "").strip() or None,
                "status": status,
                "data": data,
                "parcelas": int((row.get("Número da Parcela") or "0").strip() or "0") or None,
                "evento": EVENTO_POR_STATUS[status],
                "origem": "hotmart_csv",
            })
            contagem_status[status] += 1

    if not vendas or menor_data is None or maior_data is None:
        raise ValueError("CSV sem vendas")
    return vendas, contagem_status, menor_data, maior_data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--preflight-saida", type=Path)
    parser.add_argument("--dry-run-saida", type=Path)
    parser.add_argument("--inicio", type=int, default=0,
                        help="primeira linha de dados do lote, começando em zero")
    parser.add_argument("--limite", type=int,
                        help="quantidade máxima de vendas a incluir no lote")
    args = parser.parse_args()

    vendas, status, menor_data, maior_data = ler_vendas(args.csv)
    total_linhas_arquivo = len(vendas)
    if args.inicio < 0:
        raise ValueError("--inicio não pode ser negativo")
    fim = None if args.limite is None else args.inicio + args.limite
    if args.limite is not None and args.limite <= 0:
        raise ValueError("--limite precisa ser positivo")
    vendas = vendas[args.inicio:fim]
    if not vendas:
        raise ValueError("lote não contém vendas")
    if args.inicio or args.limite is not None:
        status = Counter(str(v["status"]) for v in vendas)
        datas_lote = [datetime.fromisoformat(str(v["data"])) for v in vendas]
        menor_data = min(datas_lote)
        maior_data = max(datas_lote)
    corpo = json.dumps(vendas, ensure_ascii=False, separators=(",", ":"))
    if "$vendas$" in corpo:
        raise ValueError("conteúdo incompatível com o delimitador SQL")

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    # Num lote histórico, o e-mail exato do relatório é a identidade mais
    # segura: um telefone reciclado ou repetido não pode colocar a compra em
    # outra pessoa. Retiramos o telefone das linhas em que o e-mail já existe,
    # o telefone pertence a outro e-mail ou o próprio CSV usa o mesmo telefone
    # para e-mails diferentes.
    sql_importacao = (
        """with bruto as (
  select x, ord,
         nullif(lower(trim(x->>'email')), '') as email,
         public.normalizar_whatsapp(x->>'telefone') as fone
  from jsonb_array_elements($vendas$"""
        + corpo
        + """$vendas$::jsonb) with ordinality as d(x, ord)
), fones_ambiguos as (
  select fone from bruto where fone is not null
  group by fone having count(distinct email) > 1
), ajustado as (
  select ord,
         case when
           exists (select 1 from public.tabela_1_leads l where lower(l.email) = bruto.email)
           or exists (
             select 1 from public.tabela_1_leads l
             where l.whatsapp = bruto.fone
               and lower(coalesce(l.email, '')) is distinct from bruto.email)
           or bruto.fone in (select fone from fones_ambiguos)
         then bruto.x || jsonb_build_object('telefone', null)
         else bruto.x end as x
  from bruto
)
select public.importar_vendas(jsonb_agg(x order by ord)) from ajustado;
"""
    )
    args.saida.write_text(sql_importacao, encoding="utf-8")

    if args.dry_run_saida:
        args.dry_run_saida.parent.mkdir(parents=True, exist_ok=True)
        args.dry_run_saida.write_text(
            "begin;\n"
            + sql_importacao
            + """select jsonb_build_object(
  'leads_na_simulacao', (select count(*) from public.tabela_1_leads),
  'pedidos_na_simulacao', (select count(*) from public.tabela_4_alunos),
  'compras_aprovadas_na_simulacao', (
    select count(*) from public.tabela_4_alunos where status = 'aprovada'),
  'eventos_pendentes_na_simulacao', (
    select count(*) from public.eventos_sistema where processado_em is null)
) as simulacao;
rollback;
""",
            encoding="utf-8",
        )

    if args.preflight_saida:
        args.preflight_saida.parent.mkdir(parents=True, exist_ok=True)
        args.preflight_saida.write_text(
            """with dados as (
  select x,
         nullif(lower(trim(x->>'email')), '') as email,
         nullif(lower(trim(x->>'nome')), '') as nome,
         public.normalizar_whatsapp(x->>'telefone') as fone,
         x->>'codigo_transacao' as transacao
  from jsonb_array_elements($vendas$"""
            + corpo
            + """$vendas$::jsonb) x
), fones_ambiguos as (
  select fone from dados where fone is not null
  group by fone having count(distinct email) > 1
), conferidos as (
  select d.*,
         p.lead_id as lead_fone,
         nullif(lower(trim(p.nome)), '') as nome_lead_fone,
         e.lead_id as lead_email,
         nullif(lower(trim(e.nome)), '') as nome_lead_email,
         c.id_compra as compra_existente
  from dados d
  left join public.tabela_1_leads p on p.whatsapp = d.fone
  left join public.tabela_1_leads e on lower(e.email) = d.email
  left join public.tabela_4_alunos c on c.codigo_transacao = d.transacao
)
select jsonb_build_object(
  'linhas', count(*),
  'transacoes_ja_existentes', count(*) filter (where compra_existente is not null),
  'transacoes_novas', count(*) filter (where compra_existente is null),
  'linhas_com_lead_existente', count(*) filter (where coalesce(lead_fone, lead_email) is not null),
  'emails_novos_distintos', count(distinct email) filter (
    where coalesce(lead_fone, lead_email) is null and email is not null),
  'sem_email_e_sem_lead', count(*) filter (
    where coalesce(lead_fone, lead_email) is null and email is null),
  'conflitos_fone_email', count(*) filter (
    where lead_fone is not null and lead_email is not null and lead_fone <> lead_email),
  'conflito_nome_confere_email', count(*) filter (
    where lead_fone is not null and lead_email is not null and lead_fone <> lead_email
      and nome = nome_lead_email and nome is not null),
  'conflito_nome_confere_fone', count(*) filter (
    where lead_fone is not null and lead_email is not null and lead_fone <> lead_email
      and nome = nome_lead_fone and nome is not null),
  'colisoes_fone_com_outro_email', count(*) filter (
    where lead_fone is not null
      and lower(coalesce((select email from public.tabela_1_leads where lead_id = lead_fone), ''))
          is distinct from email),
  'fones_ambiguos_no_csv', (select count(*) from fones_ambiguos)
) as preflight
from conferidos;
""",
            encoding="utf-8",
        )

    resumo = {
        "linhas": len(vendas),
        "linhas_no_arquivo": total_linhas_arquivo,
        "inicio_do_lote": args.inicio,
        "status": dict(status),
        "inicio": menor_data.isoformat(),
        "fim": maior_data.isoformat(),
        "arquivo_sql_bytes": args.saida.stat().st_size,
        "preflight_sql_bytes": args.preflight_saida.stat().st_size if args.preflight_saida else None,
        "dry_run_sql_bytes": args.dry_run_saida.stat().st_size if args.dry_run_saida else None,
    }
    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(1)
