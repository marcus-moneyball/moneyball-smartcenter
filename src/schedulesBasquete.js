'use strict';

const BASE_URL = 'https://api.balldontlie.io';

/**
 * Cliente da balldontlie.io — free tier genuíno (5 req/min), cobre NBA e
 * WNBA no mesmo provedor, cada liga é um "path" diferente (/nba/v1/games,
 * /wnba/v1/games), não um parâmetro de liga.
 */
function criarClienteBalldontlie(apiKey) {
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY ausente — configure via variável de ambiente.');
  }

  async function buscarJogosDoDia(path, data) {
    const url = new URL(`${BASE_URL}/${path}/v1/games`);
    url.searchParams.append('dates[]', data);

    const resposta = await fetch(url, { headers: { Authorization: apiKey } });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`balldontlie (${path}) retornou HTTP ${resposta.status}: ${corpo.slice(0, 200)}`);
    }

    const dados = await resposta.json();
    return dados.data || [];
  }

  return { buscarJogosDoDia };
}

module.exports = { criarClienteBalldontlie };
