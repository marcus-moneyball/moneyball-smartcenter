'use strict';

const BASE_URL = 'https://statsapi.mlb.com/api/v1';

/**
 * Cliente da MLB Stats API — oficial, pública, gratuita, sem chave.
 */
function criarClienteMlbStatsApi() {
  async function buscarJogosDoDia(sportId, data) {
    const url = new URL(`${BASE_URL}/schedule`);
    url.searchParams.set('sportId', sportId);
    url.searchParams.set('date', data);

    const resposta = await fetch(url);

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`MLB Stats API retornou HTTP ${resposta.status}: ${corpo.slice(0, 200)}`);
    }

    const dados = await resposta.json();
    const jogos = [];
    for (const dia of dados.dates || []) {
      for (const jogo of dia.games || []) jogos.push(jogo);
    }
    return jogos;
  }

  return { buscarJogosDoDia };
}

module.exports = { criarClienteMlbStatsApi };
