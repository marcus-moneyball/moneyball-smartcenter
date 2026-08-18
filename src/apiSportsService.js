'use strict';

const LIMITE_DIARIO = 100; // por esporte — cada produto API-Sports tem cota própria

// Cada esporte é um host diferente. "endpointJogos" muda entre football
// ("fixtures") e basketball/baseball ("games") — confirme isso contra uma
// chamada real se algo vier vazio, a nomenclatura da API-Sports não é 100%
// uniforme entre produtos.
const CONFIG_POR_ESPORTE = {
  futebol: { host: 'https://v3.football.api-sports.io', endpointJogos: 'fixtures' },
  basquete: { host: 'https://v1.basketball.api-sports.io', endpointJogos: 'games' },
  beisebol: { host: 'https://v1.baseball.api-sports.io', endpointJogos: 'games' },
};

/**
 * Cliente minimalista da API-Sports, parametrizado por esporte (cada um é
 * um produto/host/cota diferente, mesma chave de API pra todos, segundo a
 * conta unificada da API-Sports).
 */
function criarClienteApiSports(apiKey, esporte) {
  if (!apiKey) {
    throw new Error('API_SPORTS_KEY ausente — configure via variável de ambiente.');
  }
  const config = CONFIG_POR_ESPORTE[esporte];
  if (!config) {
    throw new Error(`Esporte "${esporte}" não configurado no apiSportsService. Válidos: ${Object.keys(CONFIG_POR_ESPORTE).join(', ')}.`);
  }

  async function chamar(caminho, params = {}) {
    const url = new URL(`${config.host}${caminho}`);
    Object.entries(params).forEach(([chave, valor]) => url.searchParams.set(chave, valor));

    const resposta = await fetch(url, { headers: { 'x-apisports-key': apiKey } });

    if (!resposta.ok) {
      throw new Error(`API-Sports (${esporte}) retornou HTTP ${resposta.status} em ${caminho}`);
    }

    const dados = await resposta.json();
    const temErro = Array.isArray(dados.errors) ? dados.errors.length > 0 : Object.keys(dados.errors || {}).length > 0;
    if (temErro) {
      throw new Error(`API-Sports (${esporte}) retornou erro em ${caminho}: ${JSON.stringify(dados.errors)}`);
    }

    return dados.response;
  }

  return {
    /** 1 chamada = todos os jogos de UMA liga numa data. */
    async buscarJogosPorLigaEData(apiSportsLigaId, data, temporada) {
      return chamar(`/${config.endpointJogos}`, { league: apiSportsLigaId, date: data, season: temporada });
    },

    /** 1 chamada = odds de todos os jogos de UMA liga numa data (não por jogo). */
    async buscarOddsPorLigaEData(apiSportsLigaId, data, temporada) {
      return chamar('/odds', { league: apiSportsLigaId, date: data, season: temporada });
    },

    /** 1 chamada por TIME — só usar pra times que jogam hoje e sem cache recente. */
    async buscarEstatisticasDeTime(apiSportsTimeId, apiSportsLigaId, temporada) {
      return chamar(`/${esporte === 'futebol' ? 'teams' : 'teams'}/statistics`, {
        team: apiSportsTimeId,
        league: apiSportsLigaId,
        season: temporada,
      });
    },
  };
}

module.exports = { criarClienteApiSports, LIMITE_DIARIO, CONFIG_POR_ESPORTE };
