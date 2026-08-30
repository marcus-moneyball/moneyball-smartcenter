"""
Motor quantitativo de futebol (Vercel Python Function).

Responsabilidade: receber estatísticas + odds + game_script (já determinados
pelo Engine 1), e calcular — via modelo estatístico real (Poisson sobre
gols esperados), NUNCA via IA — a probabilidade de cada mercado, o edge
sobre a odd oferecida, a correlação entre mercados candidatos, e a
recomendação final de unidades. O Engine 2 (Groq) só narra o que sai daqui,
nunca recalcula nada.

Modelo: gols marcados por cada time seguem Poisson(lambda), onde:
  lambda_casa = média(xg_casa, xga_visitante) * vantagem_de_casa
  lambda_visitante = média(xg_visitante, xga_casa)

Isso é uma simplificação deliberada (não é Dixon-Coles completo, não corrige
sub/superdispersão) — é um primeiro modelo real e auditável, melhor que uma
IA "achando" um número, mas com espaço pra refinar depois com dados reais.
"""

import json
import math
import os
from http.server import BaseHTTPRequestHandler

MAX_GOLS = 9  # cobertura de 0 a 9 gols por time — cauda além disso é desprezível
VANTAGEM_CASA = 1.10  # multiplicador simples sobre lambda_casa — ajustável com dado real depois

# Limiares de edge → unidades, direto do framework do usuário.
def unidades_por_edge(edge):
    if edge < 0.02:
        return 0
    if edge < 0.05:
        return 0.5
    if edge < 0.10:
        return 1.0
    return 2.0  # >10% — framework pede atenção a possível viés do modelo, sinalizamos à parte


def poisson_pmf(k, lam):
    """P(X = k) para X ~ Poisson(lam). Implementado sem scipy pra manter a função leve (cold start)."""
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def montar_matriz_placares(lambda_casa, lambda_visitante):
    """Matriz [gols_casa][gols_visitante] = probabilidade conjunta (assume independência)."""
    matriz = [[0.0] * (MAX_GOLS + 1) for _ in range(MAX_GOLS + 1)]
    for i in range(MAX_GOLS + 1):
        p_i = poisson_pmf(i, lambda_casa)
        for j in range(MAX_GOLS + 1):
            matriz[i][j] = p_i * poisson_pmf(j, lambda_visitante)
    return matriz


def calcular_lambdas(estatisticas):
    xg_casa = estatisticas.get('xg_casa')
    xg_visitante = estatisticas.get('xg_visitante')
    xga_casa = estatisticas.get('xga_casa')
    xga_visitante = estatisticas.get('xga_visitante')

    if None in (xg_casa, xg_visitante, xga_casa, xga_visitante):
        return None, None, 'xg_casa/xg_visitante/xga_casa/xga_visitante incompletos — Engine 1 não achou tudo, não dá pra rodar o modelo.'

    lambda_casa = ((xg_casa + xga_visitante) / 2) * VANTAGEM_CASA
    lambda_visitante = (xg_visitante + xga_casa) / 2
    return lambda_casa, lambda_visitante, None


def probabilidade_moneyline(matriz):
    p_casa = sum(matriz[i][j] for i in range(MAX_GOLS + 1) for j in range(MAX_GOLS + 1) if i > j)
    p_empate = sum(matriz[i][i] for i in range(MAX_GOLS + 1))
    p_visitante = sum(matriz[i][j] for i in range(MAX_GOLS + 1) for j in range(MAX_GOLS + 1) if i < j)
    return p_casa, p_empate, p_visitante


def probabilidade_over_under(matriz, linha):
    p_over = sum(
        matriz[i][j]
        for i in range(MAX_GOLS + 1)
        for j in range(MAX_GOLS + 1)
        if (i + j) > linha
    )
    return p_over, 1 - p_over


def probabilidade_btts(matriz):
    p_casa_zero = sum(matriz[0][j] for j in range(MAX_GOLS + 1))
    p_visitante_zero = sum(matriz[i][0] for i in range(MAX_GOLS + 1))
    p_ambos_zero = matriz[0][0]
    p_btts_sim = 1 - p_casa_zero - p_visitante_zero + p_ambos_zero
    return p_btts_sim, 1 - p_btts_sim


def probabilidade_handicap_asiatico(matriz, linha_casa):
    """linha_casa negativa = casa dando vantagem (ex: -1.0 precisa vencer por 2+)."""
    p_casa_cobre = sum(
        matriz[i][j]
        for i in range(MAX_GOLS + 1)
        for j in range(MAX_GOLS + 1)
        if (i + linha_casa) > j
    )
    return p_casa_cobre, 1 - p_casa_cobre


# Tags de "direção" — usadas só pra correlação heurística entre mercados,
# não é modelagem estatística de covariância real (isso é refinamento futuro).
TAG_CASA_DOMINA = 'casa_domina'
TAG_GOLS_ALTOS = 'gols_altos'
TAG_GOLS_BAIXOS = 'gols_baixos'
TAG_VISITANTE = 'visitante'


def montar_mercados_candidatos(odds, matriz, lambda_casa, lambda_visitante):
    """
    Monta a lista de mercados candidatos a partir das odds que o Engine 1
    encontrou, calcula probabilidade_estimada (Poisson) e edge pra cada um.
    Só entra mercado pro qual existe odd real — nunca inventa mercado.
    """
    candidatos = []

    ml = odds.get('moneyline_1x2') or {}
    if ml.get('casa'):
        p_casa, _, _ = probabilidade_moneyline(matriz)
        candidatos.append(_montar_item('Moneyline (1X2) - Casa', ml['casa'], p_casa, TAG_CASA_DOMINA))
    if ml.get('visitante'):
        _, _, p_visitante = probabilidade_moneyline(matriz)
        candidatos.append(_montar_item('Moneyline (1X2) - Visitante', ml['visitante'], p_visitante, TAG_VISITANTE))

    for linha_obj in (odds.get('gols_over_under') or []):
        linha = linha_obj.get('linha')
        if linha is None:
            continue
        p_over, p_under = probabilidade_over_under(matriz, linha)
        if linha_obj.get('over'):
            candidatos.append(_montar_item(f'Over {linha} Gols', linha_obj['over'], p_over, TAG_GOLS_ALTOS))
        if linha_obj.get('under'):
            candidatos.append(_montar_item(f'Under {linha} Gols', linha_obj['under'], p_under, TAG_GOLS_BAIXOS))

    btts = odds.get('ambas_marcam') or odds.get('btts') or {}
    if btts.get('sim'):
        p_sim, _ = probabilidade_btts(matriz)
        candidatos.append(_montar_item('Ambas Marcam - Sim', btts['sim'], p_sim, TAG_GOLS_ALTOS))
    if btts.get('nao'):
        _, p_nao = probabilidade_btts(matriz)
        candidatos.append(_montar_item('Ambas Marcam - Não', btts['nao'], p_nao, TAG_GOLS_BAIXOS))

    for linha_obj in (odds.get('handicap_asiatico') or []):
        linha = linha_obj.get('linha')
        if linha is None:
            continue
        p_casa_cobre, p_visitante_cobre = probabilidade_handicap_asiatico(matriz, linha)
        if linha_obj.get('casa'):
            candidatos.append(_montar_item(f'Handicap Asiático Casa {linha}', linha_obj['casa'], p_casa_cobre, TAG_CASA_DOMINA))
        if linha_obj.get('visitante'):
            candidatos.append(_montar_item(f'Handicap Asiático Visitante {-linha}', linha_obj['visitante'], p_visitante_cobre, TAG_VISITANTE))

    return candidatos


def _montar_item(mercado, odd, probabilidade_estimada, tag):
    probabilidade_implicita = 1 / odd if odd else None
    edge = (probabilidade_estimada - probabilidade_implicita) if probabilidade_implicita is not None else None
    # "Bet to": a odd onde o edge zera (1 / probabilidade_estimada) — acima
    # desse valor a aposta deixa de ter valor matemático.
    bet_to = round(1 / probabilidade_estimada, 3) if probabilidade_estimada and probabilidade_estimada > 0 else None
    return {
        'mercado': mercado,
        'odd': odd,
        'probabilidade_estimada': round(probabilidade_estimada, 4),
        'probabilidade_implicita': round(probabilidade_implicita, 4) if probabilidade_implicita else None,
        'edge': round(edge, 4) if edge is not None else None,
        'bet_to': bet_to,
        'unidades_recomendadas': unidades_por_edge(edge) if edge is not None else 0,
        'possivel_vies_se_edge_alto': edge is not None and edge > 0.10,
        'tag_correlacao': tag,
    }


def correlacao(tag_a, tag_b):
    if tag_a == tag_b:
        return 'Positiva'
    opostos = {(TAG_CASA_DOMINA, TAG_VISITANTE), (TAG_VISITANTE, TAG_CASA_DOMINA),
               (TAG_GOLS_ALTOS, TAG_GOLS_BAIXOS), (TAG_GOLS_BAIXOS, TAG_GOLS_ALTOS)}
    if (tag_a, tag_b) in opostos:
        return 'Negativa'
    return 'Neutra'


def montar_bilhete_recomendado(candidatos):
    """
    Regras de Ouro do framework: só entra mercado com edge >= 2%, máximo 3
    entradas, nunca inclui par com correlação Negativa entre si, prioriza
    maior edge primeiro (a entrada "âncora").
    """
    elegiveis = sorted(
        [c for c in candidatos if c['edge'] is not None and c['edge'] >= 0.02],
        key=lambda c: c['edge'],
        reverse=True,
    )

    bilhete = []
    for candidato in elegiveis:
        if len(bilhete) >= 3:
            break
        contradiz = any(correlacao(candidato['tag_correlacao'], j['tag_correlacao']) == 'Negativa' for j in bilhete)
        if not contradiz:
            bilhete.append(candidato)

    return bilhete


def calcular(payload):
    esporte = payload.get('esporte')
    if esporte != 'futebol':
        return {'sucesso': False, 'erro': f'Motor quant de futebol não atende esporte "{esporte}".'}

    estatisticas = payload.get('estatisticas') or {}
    odds = payload.get('odds') or {}

    lambda_casa, lambda_visitante, erro = calcular_lambdas(estatisticas)
    if erro:
        return {'sucesso': False, 'erro': erro}

    matriz = montar_matriz_placares(lambda_casa, lambda_visitante)
    candidatos = montar_mercados_candidatos(odds, matriz, lambda_casa, lambda_visitante)
    bilhete = montar_bilhete_recomendado(candidatos)

    return {
        'sucesso': True,
        'lambda_casa': round(lambda_casa, 3),
        'lambda_visitante': round(lambda_visitante, 3),
        'mercados_calculados': candidatos,
        'bilhete_recomendado': bilhete,
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        segredo_esperado = os.environ.get('CRON_SECRET')
        auth = self.headers.get('Authorization')
        if segredo_esperado and auth != f'Bearer {segredo_esperado}':
            self._responder(401, {'sucesso': False, 'erro': 'Não autorizado.'})
            return

        try:
            tamanho = int(self.headers.get('Content-Length', 0))
            corpo = self.rfile.read(tamanho)
            payload = json.loads(corpo)
        except Exception as erro:
            self._responder(400, {'sucesso': False, 'erro': f'Body inválido: {erro}'})
            return

        resultado = calcular(payload)
        status = 200 if resultado.get('sucesso') else 400
        self._responder(status, resultado)

    def _responder(self, status, corpo):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(corpo).encode('utf-8'))
