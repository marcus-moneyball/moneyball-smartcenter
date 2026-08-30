"""
Motor quantitativo de beisebol — MLB (Vercel Python Function).

Responsabilidade: igual ao futebol.py/basquete.py — nunca deixar a IA
"achar" um número, sempre calcular via fórmula auditável.

Modelo: runs marcados por time seguem aproximadamente Poisson (evento
discreto, relativamente raro por innings) — mesma família usada pro
futebol, só trocando gols por runs e ajustando o teto da matriz.

CONVERSÃO — a parte que precisa de mais cuidado aqui: o contrato do Engine 1
pra beisebol NÃO coleta "runs marcados/sofridos por jogo" diretamente (como
faz com xg/xga no futebol) — coleta métricas sabermétricas do arremessador
titular (ERA/FIP/xFIP) e do ataque adversário (wRC+, xwOBA). Então o lambda
de cada time é ESTIMADO a partir dessas métricas, não lido direto:

  lambda_visitante = xFIP_titular_casa * (wRC+_ataque_visitante / 100)
  lambda_casa      = xFIP_titular_visitante * (wRC+_ataque_casa / 100) * VANTAGEM_CASA

Raciocínio: xFIP já é uma estimativa de "runs permitidos por 9 innings por
um arremessador desse nível contra um ataque mediano" — então multiplicar
pelo wRC+ do ataque adversário (100 = média da liga) ajusta pra cima ou pra
baixo dependendo de quão forte é esse ataque específico. Prioriza xFIP sobre
FIP sobre ERA (nessa ordem) porque xFIP é o mais preditivo/menos dependente
de sorte — segue o espírito do "Framework Mestre" de priorizar métrica
avançada sobre resultado bruto.

LIMITAÇÃO CONHECIDA (documentada de propósito): isso assume o titular
arremessa o jogo inteiro (9 innings) e ignora bullpen — é uma
simplificação de primeiro modelo, não um sistema completo de innings-por-
innings. O contrato do Engine 1 já coleta era_bullpen_casa/visitante, que
fica disponível pra um refinamento futuro (ex.: pesar as últimas ~2-3
innings pelo ERA do bullpen em vez do titular).

Baseball não tem empate — jogos empatados vão pra extra innings. A matriz
de Poisson naturalmente gera uma fatia de "placares iguais" que, na vida
real, não são o resultado final. Resolvemos isso dividindo essa fatia
proporcionalmente entre os dois times (quem tem lambda maior leva mais
dessa fatia) — é uma aproximação, não uma modelagem de extra innings de
verdade.
"""

import json
import math
import os
from http.server import BaseHTTPRequestHandler

MAX_RUNS = 14  # cobertura ampla — cauda além disso é desprezível pra um jogo de beisebol
VANTAGEM_CASA = 1.03  # bem menor que futebol — vantagem de mandante na MLB é historicamente pequena (~54% W%)


def unidades_por_edge(edge):
    if edge < 0.02:
        return 0
    if edge < 0.05:
        return 0.5
    if edge < 0.10:
        return 1.0
    return 2.0


def poisson_pmf(k, lam):
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def montar_matriz_placares(lambda_casa, lambda_visitante):
    matriz = [[0.0] * (MAX_RUNS + 1) for _ in range(MAX_RUNS + 1)]
    for i in range(MAX_RUNS + 1):
        p_i = poisson_pmf(i, lambda_casa)
        for j in range(MAX_RUNS + 1):
            matriz[i][j] = p_i * poisson_pmf(j, lambda_visitante)
    return matriz


def _melhor_metrica_pitcher(estatisticas, lado):
    """Prioriza xFIP > FIP > ERA — nessa ordem, pega a primeira que não for null."""
    for chave in (f'xfip_titular_{lado}', f'fip_titular_{lado}', f'era_titular_{lado}'):
        valor = estatisticas.get(chave)
        if valor is not None:
            return valor, chave
    return None, None


def calcular_lambdas(estatisticas):
    metrica_casa, origem_casa = _melhor_metrica_pitcher(estatisticas, 'casa')
    metrica_visitante, origem_visitante = _melhor_metrica_pitcher(estatisticas, 'visitante')
    wrc_casa = estatisticas.get('wrc_plus_ataque_casa')
    wrc_visitante = estatisticas.get('wrc_plus_ataque_visitante')

    if None in (metrica_casa, metrica_visitante, wrc_casa, wrc_visitante):
        return None, None, None, (
            'Faltou ao menos uma métrica do titular (xFIP/FIP/ERA) ou wRC+ do ataque adversário — '
            'Engine 1 não achou tudo, não dá pra rodar o modelo.'
        )

    lambda_visitante = metrica_casa * (wrc_visitante / 100)
    lambda_casa = metrica_visitante * (wrc_casa / 100) * VANTAGEM_CASA

    origem = {'casa': origem_casa, 'visitante': origem_visitante}
    return lambda_casa, lambda_visitante, origem, None


def probabilidade_moneyline_com_extra_innings(matriz, lambda_casa, lambda_visitante):
    """
    Igual ao futebol, mas sem empate final: a fatia de placares iguais
    (extra innings) é redistribuída proporcionalmente ao lambda de cada
    time — aproximação documentada no topo do arquivo.
    """
    p_casa_regulacao = sum(matriz[i][j] for i in range(MAX_RUNS + 1) for j in range(MAX_RUNS + 1) if i > j)
    p_empate = sum(matriz[i][i] for i in range(MAX_RUNS + 1))
    p_visitante_regulacao = sum(matriz[i][j] for i in range(MAX_RUNS + 1) for j in range(MAX_RUNS + 1) if i < j)

    total_lambda = lambda_casa + lambda_visitante
    fatia_casa = (lambda_casa / total_lambda) if total_lambda > 0 else 0.5
    p_casa = p_casa_regulacao + p_empate * fatia_casa
    p_visitante = p_visitante_regulacao + p_empate * (1 - fatia_casa)
    return p_casa, p_visitante


def probabilidade_over_under(matriz, linha):
    p_over = sum(matriz[i][j] for i in range(MAX_RUNS + 1) for j in range(MAX_RUNS + 1) if (i + j) > linha)
    return p_over, 1 - p_over


def probabilidade_run_line(matriz, linha_casa):
    """Mesma lógica de handicap asiático do futebol.py — linha_casa negativa = casa dando vantagem."""
    p_casa_cobre = sum(matriz[i][j] for i in range(MAX_RUNS + 1) for j in range(MAX_RUNS + 1) if (i + linha_casa) > j)
    return p_casa_cobre, 1 - p_casa_cobre


TAG_CASA_DOMINA = 'casa_domina'
TAG_VISITANTE = 'visitante'
TAG_RUNS_ALTOS = 'runs_altos'
TAG_RUNS_BAIXOS = 'runs_baixos'


def montar_mercados_candidatos(odds, matriz, lambda_casa, lambda_visitante):
    candidatos = []

    ml = odds.get('moneyline') or {}
    if ml.get('casa') or ml.get('visitante'):
        p_casa, p_visitante = probabilidade_moneyline_com_extra_innings(matriz, lambda_casa, lambda_visitante)
        if ml.get('casa'):
            candidatos.append(_montar_item('Moneyline - Casa', ml['casa'], p_casa, TAG_CASA_DOMINA))
        if ml.get('visitante'):
            candidatos.append(_montar_item('Moneyline - Visitante', ml['visitante'], p_visitante, TAG_VISITANTE))

    run_line = odds.get('run_line') or {}
    linha = run_line.get('linha')
    if linha is not None:
        p_casa_cobre, p_visitante_cobre = probabilidade_run_line(matriz, linha)
        if run_line.get('casa'):
            candidatos.append(_montar_item(f'Run Line Casa {linha}', run_line['casa'], p_casa_cobre, TAG_CASA_DOMINA))
        if run_line.get('visitante'):
            candidatos.append(_montar_item(f'Run Line Visitante {-linha}', run_line['visitante'], p_visitante_cobre, TAG_VISITANTE))

    total = odds.get('runs_total') or {}
    linha_total = total.get('linha')
    if linha_total is not None:
        p_over, p_under = probabilidade_over_under(matriz, linha_total)
        if total.get('over'):
            candidatos.append(_montar_item(f'Over {linha_total} Runs', total['over'], p_over, TAG_RUNS_ALTOS))
        if total.get('under'):
            candidatos.append(_montar_item(f'Under {linha_total} Runs', total['under'], p_under, TAG_RUNS_BAIXOS))

    # Strikeouts/hits/outs de jogador ficam fora deste v1 — mesmo motivo do
    # basquete.py: o Engine 1 coleta a odd mas não a taxa individual
    # (K/9, IP projetado) necessária pra estimar probabilidade real.

    return candidatos


def _montar_item(mercado, odd, probabilidade_estimada, tag):
    probabilidade_implicita = 1 / odd if odd else None
    edge = (probabilidade_estimada - probabilidade_implicita) if probabilidade_implicita is not None else None
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
               (TAG_RUNS_ALTOS, TAG_RUNS_BAIXOS), (TAG_RUNS_BAIXOS, TAG_RUNS_ALTOS)}
    if (tag_a, tag_b) in opostos:
        return 'Negativa'
    return 'Neutra'


def montar_bilhete_recomendado(candidatos):
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
    if esporte != 'beisebol':
        return {'sucesso': False, 'erro': f'Motor quant de beisebol não atende esporte "{esporte}".'}

    estatisticas = payload.get('estatisticas') or {}
    odds = payload.get('odds') or {}

    lambda_casa, lambda_visitante, origem, erro = calcular_lambdas(estatisticas)
    if erro:
        return {'sucesso': False, 'erro': erro}

    matriz = montar_matriz_placares(lambda_casa, lambda_visitante)
    candidatos = montar_mercados_candidatos(odds, matriz, lambda_casa, lambda_visitante)
    bilhete = montar_bilhete_recomendado(candidatos)

    return {
        'sucesso': True,
        'lambda_casa': round(lambda_casa, 3),
        'lambda_visitante': round(lambda_visitante, 3),
        'metrica_pitcher_usada': origem,
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
