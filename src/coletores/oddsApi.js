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
  futebol: ['soccer_epl'], // ajuste/expanda por liga conforme a cobertura que você quer
  basquete: ['basketball_nba', 'basketball_wnba'], // cobre as duas -- NBA às vezes está em offseason
  beisebol: ['baseball_mlb'],
};

/**
 * @param {string} esporte - 'futebol' | 'basquete' | 'beisebol'
 * @returns {Promise<Object[]>} eventos com odds de TODAS as ligas mapeadas pro esporte
 */
async function buscarOddsPorEsporte(esporte) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY não configurada.');

  const sportKeys = SPORT_KEYS[esporte];
  if (!sportKeys) {
    console.warn(`[ODDS API] Esporte "${esporte}" sem sport_key mapeado -- pulando.`);
    return [];
  }

  const todosEventos = [];
  for (const sportKey of sportKeys) {
    const url = `${BASE_URL}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us,eu&markets=h2h,totals&oddsFormat=decimal`;
    try {
      const resposta = await fetch(url);
      if (!resposta.ok) {
        console.warn(`[ODDS API] ${sportKey} respondeu ${resposta.status} -- pulando essa liga.`);
        continue;
      }
      const eventos = await resposta.json();
      todosEventos.push(...eventos);
    } catch (erro) {
      console.warn(`[ODDS API] Falha ao buscar ${sportKey}: ${erro.message}`);
    }
  }

  return todosEventos;
}

module.exports = { buscarOddsPorEsporte, SPORT_KEYS };
