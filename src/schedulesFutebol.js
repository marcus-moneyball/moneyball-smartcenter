'use strict';

const BASE_URL = 'https://api.football-data.org/v4';

/**
 * Cliente da football-data.org — free tier genuíno, sem trava de temporada.
 * 1 chamada cobre TODAS as competições configuradas de uma vez (parâmetro
 * "competitions" aceita lista separada por vírgula).
 */
function criarClienteFootballData(apiKey) {
  if (!apiKey) {
    throw new Error('FOOTBALL_DATA_API_KEY ausente — configure via variável de ambiente.');
  }

  async function buscarJogosDoDia(codigosCompeticoes, data) {
    const url = new URL(`${BASE_URL}/matches`);
    url.searchParams.set('competitions', codigosCompeticoes.join(','));
    url.searchParams.set('dateFrom', data);
    url.searchParams.set('dateTo', data);

    const resposta = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`football-data.org retornou HTTP ${resposta.status}: ${corpo.slice(0, 200)}`);
    }

    const dados = await resposta.json();
    return dados.matches || [];
  }

  return { buscarJogosDoDia };
}

module.exports = { criarClienteFootballData };
