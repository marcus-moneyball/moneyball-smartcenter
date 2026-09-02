'use strict';

/**
 * Índice de relevância 100% matemático, calculado em cima das odds já
 * coletadas (sem nenhuma chamada de API extra). Objetivo: substituir o
 * ranking grosseiro de "quantos campos vieram preenchidos" por um sinal de
 * verdade -- micro-assimetria de domínio e expectativa de pontuação --
 * pra decidir quais partidas merecem a investigação cara (Gemini) antes de
 * gastar qualquer chamada nelas.
 *
 * IMPORTANTE: os desvios-padrão e médias por esporte abaixo são valores de
 * referência conhecidos publicamente (ex: dispersão de placar da NBA), não
 * calibrados com os seus dados históricos. Funcionam como ponto de partida
 * -- se depois de rodar um tempo você quiser calibrar com os seus próprios
 * resultados, é só ajustar essas duas tabelas.
 */

const CONFIG_PLACAR_POR_LIGA = {
  soccer_epl: { desvioPadraoPlacar: 1.3, mediaTotal: 2.6, desvioTotal: 0.75 },
  basketball_nba: { desvioPadraoPlacar: 12, mediaTotal: 225, desvioTotal: 15 },
  basketball_wnba: { desvioPadraoPlacar: 9, mediaTotal: 163, desvioTotal: 11 },
  // Valores aproximados de referência pública (não calibrados com dados
  // históricos), mesmo aviso das outras ligas acima.
  baseball_mlb: { desvioPadraoPlacar: 3, mediaTotal: 8.5, desvioTotal: 2.2 },
};

function encontrarMercado(bookmakers, marketKey) {
  const pinnacle = bookmakers?.find((b) => b.key === 'pinnacle');
  if (pinnacle) {
    const mercado = pinnacle.markets?.find((m) => m.key === marketKey);
    if (mercado) return mercado;
  }
  for (const bookmaker of bookmakers || []) {
    const mercado = bookmaker.markets?.find((m) => m.key === marketKey);
    if (mercado) return mercado;
  }
  return null;
}

// Aproximação de erro (Abramowitz-Stegun) -- suficiente pra um índice de
// ranking, não precisa de precisão de biblioteca estatística.
function erf(x) {
  const sinal = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sinal * y;
}

function probabilidadeNormalAcumulada(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Probabilidade implícita de vitória via moneyline, removendo a margem da
 * casa (devig). Simplificação para futebol (3 vias): ignora o empate e
 * normaliza só entre casa/fora -- é uma aproximação grosseira, não uma
 * modelagem de empate real, mas suficiente pra comparar contra o spread.
 */
function probabilidadeViaMoneyline(h2h, timeA) {
  if (!h2h || h2h.outcomes.length < 2) return null;
  const outcomeA = h2h.outcomes.find((o) => o.name === timeA);
  const outcomesRelevantes = h2h.outcomes.filter((o) => o.name !== 'Draw');
  if (!outcomeA || outcomesRelevantes.length !== 2) return null;

  const probsBrutas = outcomesRelevantes.map((o) => 1 / o.price);
  const somaProbsBrutas = probsBrutas.reduce((a, b) => a + b, 0);
  const probA = 1 / outcomeA.price;
  return probA / somaProbsBrutas; // devig
}

/**
 * Probabilidade implícita de vitória via handicap/spread, convertendo os
 * pontos de vantagem numa probabilidade através de uma normal padrão
 * (Φ(pontos / desvio_padrão_do_esporte)).
 */
function probabilidadeViaSpread(spreads, timeA, sportKey) {
  if (!spreads) return null;
  const outcomeA = spreads.outcomes.find((o) => o.name === timeA);
  if (!outcomeA || outcomeA.point == null) return null;

  const config = CONFIG_PLACAR_POR_LIGA[sportKey];
  if (!config) return null;

  // point negativo = time A favorito por esse tanto; positivo = zebra
  const vantagem = -outcomeA.point;
  return probabilidadeNormalAcumulada(vantagem / config.desvioPadraoPlacar);
}

/**
 * O quanto a linha de over/under foge da média típica do esporte,
 * normalizado pelo desvio-padrão típico -- games muito acima/abaixo da
 * média costumam ter mais informação de mercado embutida.
 */
function desvioExpectativaPontuacao(totals, sportKey) {
  if (!totals) return 0;
  const linha = totals.outcomes.find((o) => o.name === 'Over')?.point;
  if (linha == null) return 0;

  const config = CONFIG_PLACAR_POR_LIGA[sportKey];
  if (!config) return 0;

  return Math.abs(linha - config.mediaTotal) / config.desvioTotal;
}

/**
 * @param {string} sportKey - ex: 'soccer_epl', 'basketball_nba', 'basketball_wnba'
 * @param {Object} eventoBruto - JSON cru da The Odds API
 * @returns {number} índice de relevância (maior = mais interessante de investigar)
 */
function calcularIndiceRelevancia(sportKey, eventoBruto) {
  const bookmakers = eventoBruto.bookmakers || [];
  const timeA = eventoBruto.home_team;

  const h2h = encontrarMercado(bookmakers, 'h2h');
  const spreads = encontrarMercado(bookmakers, 'spreads');
  const totals = encontrarMercado(bookmakers, 'totals');

  const probML = probabilidadeViaMoneyline(h2h, timeA);
  const probSpread = probabilidadeViaSpread(spreads, timeA, sportKey);

  const microAssimetriaDominio = probML != null && probSpread != null ? Math.abs(probML - probSpread) : 0;
  const expectativaPontuacao = desvioExpectativaPontuacao(totals, sportKey);

  // Pesos iguais por enquanto -- ajustável depois de observar resultados reais.
  return microAssimetriaDominio * 10 + expectativaPontuacao;
}

module.exports = { calcularIndiceRelevancia };
