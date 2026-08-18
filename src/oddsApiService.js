'use strict';

const BASE_URL = 'https://api.the-odds-api.com/v4';

/**
 * Cliente minimalista da The Odds API. Cada "sport_key" da The Odds API
 * (formato próprio deles, diferente dos IDs da API-Sports) devolve TODOS os
 * jogos daquele esporte/liga numa chamada só — já é naturalmente em lote.
 */
function criarClienteOddsApi(apiKey) {
  if (!apiKey) {
    throw new Error('ODDS_API_KEY ausente — configure via variável de ambiente.');
  }

  /**
   * buscarOddsPorEsporte(sportKey)
   * @returns {Promise<Array>} eventos com odds de múltiplas casas
   */
  async function buscarOddsPorEsporte(sportKey, opcoes = {}) {
    const url = new URL(`${BASE_URL}/sports/${sportKey}/odds`);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('regions', opcoes.regions || 'us,uk,eu');
    url.searchParams.set('markets', opcoes.markets || 'h2h');
    url.searchParams.set('oddsFormat', 'decimal');

    const resposta = await fetch(url);

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`The Odds API retornou HTTP ${resposta.status} em ${sportKey}: ${corpo.slice(0, 200)}`);
    }

    // A The Odds API devolve a cota restante nos headers — útil registrar.
    const restante = resposta.headers.get('x-requests-remaining');
    const usado = resposta.headers.get('x-requests-used');

    const dados = await resposta.json();
    return { eventos: dados, cotaRestante: restante, cotaUsada: usado };
  }

  return { buscarOddsPorEsporte };
}

module.exports = { criarClienteOddsApi };
