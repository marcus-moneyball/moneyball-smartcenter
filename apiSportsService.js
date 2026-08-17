'use strict';

const BASE_URL = 'https://v3.football.api-sports.io';
const LIMITE_DIARIO = 100;

/**
 * Cliente minimalista da API-Sports (football v3). Cada método corresponde
 * a UMA chamada de API — quem orquestra (coletaNoturna.js) decide quantas
 * chamadas fazer e em que ordem, respeitando o orçamento diário.
 *
 * NUNCA busca jogo por jogo — os métodos aqui são todos "por liga" ou
 * "por time", desenhados pra cobrir o máximo de jogos por requisição.
 */
function criarClienteApiSports(apiKey) {
  if (!apiKey) {
    throw new Error('API_SPORTS_KEY ausente — configure via variável de ambiente.');
  }

  async function chamar(caminho, params = {}) {
    const url = new URL(`${BASE_URL}${caminho}`);
    Object.entries(params).forEach(([chave, valor]) => url.searchParams.set(chave, valor));

    const resposta = await fetch(url, {
      headers: { 'x-apisports-key': apiKey },
    });

    if (!resposta.ok) {
      throw new Error(`API-Sports retornou HTTP ${resposta.status} em ${caminho}`);
    }

    const dados = await resposta.json();

    if (Array.isArray(dados.errors) ? dados.errors.length > 0 : Object.keys(dados.errors || {}).length > 0) {
      throw new Error(`API-Sports retornou erro em ${caminho}: ${JSON.stringify(dados.errors)}`);
    }

    return dados.response;
  }

  return {
    /** 1 chamada = todos os jogos de UMA liga numa data. */
    async buscarFixturesPorLigaEData(apiSportsLigaId, data, temporada) {
      return chamar('/fixtures', { league: apiSportsLigaId, date: data, season: temporada });
    },

    /** 1 chamada = odds de todos os jogos de UMA liga numa data (não por jogo). */
    async buscarOddsPorLigaEData(apiSportsLigaId, data, temporada) {
      return chamar('/odds', { league: apiSportsLigaId, date: data, season: temporada });
    },

    /** 1 chamada por TIME — só usar pra times que jogam hoje e sem cache recente (ver statsDeTimeEstaoFrescas). */
    async buscarEstatisticasDeTime(apiSportsTimeId, apiSportsLigaId, temporada) {
      return chamar('/teams/statistics', { team: apiSportsTimeId, league: apiSportsLigaId, season: temporada });
    },
  };
}

module.exports = { criarClienteApiSports, LIMITE_DIARIO };
