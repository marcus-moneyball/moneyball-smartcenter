'use strict';

/**
 * Traduz o formato cru da The Odds API (bookmakers[].markets[].outcomes[])
 * para o formato de caminhos aninhados que filtroQualidade.js espera em
 * cotacoes_odds_api (ver REQUISITOS_POR_ESPORTE em src/filtroQualidade.js).
 *
 * Regra geral: usa o primeiro bookmaker da lista que tiver o mercado
 * desejado (a The Odds API já devolve vários bookmakers por evento; não há
 * hoje critério de "melhor" bookmaker -- pode evoluir pra pegar a melhor
 * odd entre eles). Campos ausentes ficam undefined (contam como cobertura
 * incompleta no filtro, não quebram nada -- fail-open).
 */

function encontrarMercado(bookmakers, marketKey) {
  for (const bookmaker of bookmakers || []) {
    const mercado = bookmaker.markets?.find((m) => m.key === marketKey);
    if (mercado) return mercado;
  }
  return null;
}

function normalizarFutebol(eventoBruto, timeA, timeB) {
  const bookmakers = eventoBruto.bookmakers || [];
  const resultado = {};

  // Chance Dupla (1X/X2/12) -- a The Odds API não tem um market_key nativo
  // pra isso; aproxima a partir do h2h de 3 vias (casa/empate/fora) somando
  // a probabilidade implícita dos dois lados e invertendo pra odd.
  const h2h = encontrarMercado(bookmakers, 'h2h');
  if (h2h && h2h.outcomes.length === 3) {
    const porNome = Object.fromEntries(h2h.outcomes.map((o) => [o.name, o.price]));
    const oddCasa = porNome[timeA];
    const oddEmpate = porNome['Draw'];
    const oddFora = porNome[timeB];
    if (oddCasa && oddEmpate) {
      const probSoma = 1 / oddCasa + 1 / oddEmpate;
      resultado.chance_dupla = { ...resultado.chance_dupla, '1X': Number((1 / probSoma).toFixed(3)) };
    }
    if (oddFora && oddEmpate) {
      const probSoma = 1 / oddFora + 1 / oddEmpate;
      resultado.chance_dupla = { ...resultado.chance_dupla, X2: Number((1 / probSoma).toFixed(3)) };
    }
  }

  // Over/Under gols -- market 'totals', procurando o outcome com point 2.5
  const totals = encontrarMercado(bookmakers, 'totals');
  if (totals) {
    const over25 = totals.outcomes.find((o) => o.name === 'Over' && o.point === 2.5);
    if (over25) resultado.linhas_gols = { over_2_5: over25.price };
  }

  // Ambas Marcam (BTTS) -- market 'btts', nem todo bookmaker/região oferece
  const btts = encontrarMercado(bookmakers, 'btts');
  if (btts) {
    const sim = btts.outcomes.find((o) => o.name === 'Yes');
    if (sim) resultado.ambas_marcam = { sim: sim.price };
  }

  return resultado;
}

function normalizarBasquete(eventoBruto, timeA, timeB) {
  const bookmakers = eventoBruto.bookmakers || [];
  const resultado = {};

  const h2h = encontrarMercado(bookmakers, 'h2h');
  if (h2h) {
    const casa = h2h.outcomes.find((o) => o.name === timeA);
    if (casa) resultado.moneyline = { casa: casa.price };
  }

  const spreads = encontrarMercado(bookmakers, 'spreads');
  if (spreads) {
    const casa = spreads.outcomes.find((o) => o.name === timeA);
    if (casa) resultado.handicap = { linha: casa.point, odd: casa.price };
  }

  const totals = encontrarMercado(bookmakers, 'totals');
  if (totals) {
    const over = totals.outcomes.find((o) => o.name === 'Over');
    if (over) resultado.total_pontos = { over: over.price, linha: over.point };
  }

  return resultado;
}

/**
 * @param {string} esporte
 * @param {Object} eventoBruto - o objeto de evento cru devolvido pela The Odds API
 * @param {string} timeA - home_team
 * @param {string} timeB - away_team
 * @returns {Object} objeto no formato esperado por cotacoes_odds_api
 */
function normalizarOdds(esporte, eventoBruto, timeA, timeB) {
  if (esporte === 'futebol') return normalizarFutebol(eventoBruto, timeA, timeB);
  if (esporte === 'basquete') return normalizarBasquete(eventoBruto, timeA, timeB);
  console.warn(`[NORMALIZAR ODDS] Esporte "${esporte}" sem normalizador definido -- devolvendo vazio.`);
  return {};
}

module.exports = { normalizarOdds };
