'use strict';

/**
 * Conector da The Odds API (the-odds-api.com). Busca odds por esporte/liga.
 *
 * NOTA: os "sport keys" e nomes de mercado abaixo seguem o formato público
 * da The Odds API no momento em que este código foi escrito -- confirme na
 * documentação da sua conta (plano/região podem mudar mercados disponíveis)
 * antes de rodar em produção.
 */

const BASE_URL = 'https://api.the-odds-api.com/v4';

const SPORT_KEYS = {
  futebol: 'soccer_epl', // ajuste/expanda por liga conforme a cobertura que você quer
  basquete: 'basketball_nba',
  beisebol: 'baseball_mlb',
};

/**
 * @param {string} esporte - 'futebol' | 'basquete' | 'beisebol'
 * @returns {Promise<Object[]>} eventos com odds (formato bruto da The Odds API)
 */
async function buscarOddsPorEsporte(esporte) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY não configurada.');

  const sportKey = SPORT_KEYS[esporte];
  if (!sportKey) {
    console.warn(`[ODDS API] Esporte "${esporte}" sem sport_key mapeado -- pulando.`);
    return [];
  }

  const url = `${BASE_URL}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us,eu&markets=h2h,totals&oddsFormat=decimal`;

  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error(`Odds API respondeu ${resposta.status} para ${sportKey}`);
  }
  return resposta.json();
}

module.exports = { buscarOddsPorEsporte, SPORT_KEYS };
