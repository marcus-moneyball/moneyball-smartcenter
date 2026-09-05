'use strict';

const { investigarStats } = require('./statsGemini');
const { buscarStatsFutebol: buscarStatsFutebolFootballData } = require('./statsFootballData');
const { buscarStatsBasquete: buscarStatsBasqueteBallDontLie } = require('./statsBallDontLie');
const { buscarStatsBeisebol: buscarStatsBeisebolMlbApi } = require('./statsMlbApi');

/**
 * Ponto único de acesso a "stats por esporte" no pipeline. Ordem de
 * prioridade pra cada esporte: API estruturada de verdade primeiro (não
 * scraping de site de consumo -- essas não têm o problema de bloqueio
 * anti-bot que vimos com Understat/Basketball-Reference/stats.nba.com,
 * que são bloqueados especificamente pra provedores de nuvem como a
 * Vercel), Gemini com busca como rede de segurança quando a API não cobre
 * o time/liga (ex: WNBA na balldontlie, que só tem NBA).
 *
 * Todas as métricas aqui são a MESMA coisa que o Pro já usa internamente
 * (marcado/sofrido por jogo, via estimar_lambda) -- não estamos tentando
 * replicar xG/advanced-stats de verdade, só alimentar o modelo que o Pro
 * já tem com o dado que ele realmente precisa.
 */
async function buscarStatsPorEsporte(esporte, { timeA, timeB, sportKey }) {
  if (esporte === 'futebol') {
    try {
      const viaApi = await buscarStatsFutebolFootballData(timeA, timeB, sportKey);
      if (viaApi) return viaApi;
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no football-data.org (caindo pro Gemini): ${erro.message}`);
    }
    return investigarStats('futebol', timeA, timeB);
  }

  if (esporte === 'basquete') {
    try {
      const viaApi = await buscarStatsBasqueteBallDontLie(timeA, timeB);
      if (viaApi) return viaApi;
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no balldontlie.io (caindo pro Gemini): ${erro.message}`);
    }
    return investigarStats('basquete', timeA, timeB);
  }

  if (esporte === 'beisebol') {
    try {
      const viaApi = await buscarStatsBeisebolMlbApi(timeA, timeB);
      if (viaApi) return viaApi;
    } catch (erro) {
      console.warn(`[SPORTS API] Falha na MLB Stats API (caindo pro Gemini): ${erro.message}`);
    }
    return investigarStats('beisebol', timeA, timeB);
  }

  console.warn(`[SPORTS API] Sem provider de stats configurado para "${esporte}" -- seguindo sem stats (fail-open).`);
  return null;
}

module.exports = { buscarStatsPorEsporte };
