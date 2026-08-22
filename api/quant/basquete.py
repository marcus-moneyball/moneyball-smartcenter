"""
Motor quantitativo de basquete — NBA e WNBA (Vercel Python Function).

Responsabilidade: igual ao futebol.py — receber estatísticas + odds já
coletadas pelo Engine 1, e calcular via modelo estatístico real (NUNCA via
IA) a probabilidade de cada mercado, o edge, e a recomendação de unidades.

Modelo: pontuação de basquete NÃO segue Poisson (a contagem é alta demais —
Poisson assume eventos raros independentes; pontos em basquete não são
raros). O padrão estatístico aceito pra pontuação de equipe em esportes de
alta pontuação é aproximar por uma distribuição Normal.

  mu_casa      = (pontos_por_jogo_casa + pontos_por_jogo_visitante) / 2 + margem_esperada / 2
  mu_visitante = (pontos_por_jogo_casa + pontos_por_jogo_visitante) / 2 - margem_esperada / 2
  margem_esperada = (net_rating_casa - net_rating_visitante) * (pace_medio / 100) + VANTAGEM_CASA

LIMITAÇÃO CONHECIDA (documentada de propósito, igual ao futebol.py): o
contrato do Engine 1 coleta "pontos_por_jogo" (pontos marcados) mas não
"pontos sofridos" por time — então o mu de cada time não é ajustado pela
defesa do adversário além do que o net_rating já captura de forma agregada.
Isso é um modelo de primeira geração; o próximo refinamento seria o Engine 1
também coletar pontos sofridos por jogo pra um ajuste ofensiva-vs-defesa
como o futebol.py já faz com xg/xga.
"""

import json
import math
import os
from http.server import BaseHTTPRequestHandler

VANTAGEM_CASA_NBA = 2.0    # pontos — vantagem de mandante histórica NBA (vem encolhendo nos últimos anos)
VANTAGEM_CASA_WNBA = 1.5   # WNBA tem menos jogos/temporada, amostra de vantagem de mandante mais ruidosa

SIGMA_TIME_NBA = 12.0      # desvio-padrão histórico de pontos por time por jogo (NBA)
SIGMA_TIME_WNBA = 9.5      # WNBA pontua menos, variância proporcionalmente menor — aproximação, menos validada

PACE_MEDIO_PADRAO = 100.0  # possessions/48min de referência caso pace não venha nos dois times


def unidades_por_edge(edge):
    if edge < 0.02:
        return 0
    if edge < 0.05:
        return 0.5
    if edge < 0.10:
        return 1.0
    return 2.0


def norm_cdf(x, mu, sigma):
    """P(X <= x) para X ~ Normal(mu, sigma). math.erf é biblioteca padrão — sem scipy."""
    if sigma <= 0:
        return 1.0 if x >= mu else 0.0
    return 0.5 * (1 + math.erf((x - mu) / (sigma * math.sqrt(2))))


def parametros_por_esporte(esporte):
    if esporte == 'wnba':
        return VANTAGEM_CASA_WNBA, SIGMA_TIME_WNBA
    return VANTAGEM_CASA_NBA, SIGMA_TIME_NBA


def calcular_mu(estatisticas, esporte):
    net_rating_casa = estatisticas.get('net_rating_casa')
    net_rating_visitante = estatisticas.get('net_rating_visitante')
    pontos_casa = estatisticas.get('pontos_por_jogo_casa')
    pontos_visitante = estatisticas.get('pontos_por_jogo_visitante')
    pace_casa = estatisticas.get('pace_casa')
    pace_visitante = estatisticas.get('pace_visitante')

    if None in (net_rating_casa, net_rating_visitante, pontos_casa, pontos_visitante):
        return None, None, 'net_rating_casa/visitante e pontos_por_jogo_casa/visitante incompletos — Engine 1 não achou tudo, não dá pra rodar o modelo.'

    vantagem_casa, _ = parametros_por_esporte(esporte)
    pace_medio = PACE_MEDIO_PADRAO
    if pace_casa is not None and pace_visitante is not None:
        pace_medio = (pace_casa + pace_visitante) / 2

    margem_esperada = (net_rating_casa - net_rating_visitante) * (pace_medio / 100) + vantagem_casa
    total_esperado = pontos_casa + pontos_visitante

    mu_casa = (total_esperado / 2) + (margem_esperada / 2)
    mu_visitante = (total_esperado / 2) - (margem_esperada / 2)

    return mu_casa, mu_visitante, None


TAG_CASA_DOMINA = 'casa_domina'
TAG_VISITANTE = 'visitante'
TAG_PONTOS_ALTOS = 'pontos_altos'
TAG_PONTOS_BAIXOS = 'pontos_baixos'


def montar_mercados_candidatos(odds, mu_casa, mu_visitante, sigma_time):
    candidatos = []
    sigma_par = math.sqrt(2) * sigma_time  # var(A-B) = var(A)+var(B) assumindo independência — simplificação documentada

    ml = odds.get('moneyline') or {}
    if ml.get('casa'):
        p_casa = 1 - norm_cdf(0, mu_casa - mu_visitante, sigma_par)
        candidatos.append(_montar_item('Moneyline - Casa', ml['casa'], p_casa, TAG_CASA_DOMINA))
    if ml.get('visitante'):
        p_visitante = norm_cdf(0, mu_casa - mu_visitante, sigma_par)
        candidatos.append(_montar_item('Moneyline - Visitante', ml['visitante'], p_visitante, TAG_VISITANTE))

    handicap = odds.get('handicap') or {}
    linha = handicap.get('linha')
    if linha is not None:
        # linha aplicada à casa (ex.: -5.5 = casa precisa vencer por mais de 5.5)
        p_casa_cobre = 1 - norm_cdf(-linha, mu_casa - mu_visitante, sigma_par)
        if handicap.get('casa'):
            candidatos.append(_montar_item(f'Handicap Casa {linha}', handicap['casa'], p_casa_cobre, TAG_CASA_DOMINA))
        if handicap.get('visitante'):
            candidatos.append(_montar_item(f'Handicap Visitante {-linha}', handicap['visitante'], 1 - p_casa_cobre, TAG_VISITANTE))

    total = odds.get('total_pontos') or {}
    linha_total = total.get('linha')
    if linha_total is not None:
        p_over = 1 - norm_cdf(linha_total, mu_casa + mu_visitante, sigma_par)
        if total.get('over'):
            candidatos.append(_montar_item(f'Over {linha_total} Pontos', total['over'], p_over, TAG_PONTOS_ALTOS))
        if total.get('under'):
            candidatos.append(_montar_item(f'Under {linha_total} Pontos', total['under'], 1 - p_over, TAG_PONTOS_BAIXOS))

    # Props de jogador ficam fora deste v1 — o contrato do Engine 1 coleta
    # linha/odd de props, mas não coleta a média/variância do jogador
    # individual necessária pra estimar probabilidade real. Calcular isso
    # aqui seria "inventar" um número — melhor deixar de fora até o Engine 1
    # coletar isso, igual ao princípio de nunca estimar sem dado real.

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
               (TAG_PONTOS_ALTOS, TAG_PONTOS_BAIXOS), (TAG_PONTOS_BAIXOS, TAG_PONTOS_ALTOS)}
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
    if esporte not in ('basquete', 'nba', 'wnba'):
        return {'sucesso': False, 'erro': f'Motor quant de basquete não atende esporte "{esporte}".'}

    # normaliza "basquete"/"nba" pro mesmo tratamento; só "wnba" muda a constante de vantagem/sigma
    esporte_normalizado = 'wnba' if esporte == 'wnba' else 'nba'

    estatisticas = payload.get('estatisticas') or {}
    odds = payload.get('odds') or {}

    mu_casa, mu_visitante, erro = calcular_mu(estatisticas, esporte_normalizado)
    if erro:
        return {'sucesso': False, 'erro': erro}

    _, sigma_time = parametros_por_esporte(esporte_normalizado)
    candidatos = montar_mercados_candidatos(odds, mu_casa, mu_visitante, sigma_time)
    bilhete = montar_bilhete_recomendado(candidatos)

    return {
        'sucesso': True,
        'mu_casa': round(mu_casa, 2),
        'mu_visitante': round(mu_visitante, 2),
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
