'use strict';

const { investigarStats } = require('./statsGemini');
const { buscarStatsBasquete } = require('./statsBasketballReference');

/**
 * Ponto único de acesso a "stats por esporte" no pipeline.
 *
 * - basquete: scraper direto do basketball-reference.com -- grátis, sem
 *   Gemini, dado real (não proxy). Ver statsBasketballReference.js.
 * - futebol: Gemini com Google Search Grounding (statsGemini.js) -- o FBref
 *   desativou os stats avançados (xG) em janeiro/2026, então a fonte
 *   original que você usa no Pro para futebol não serve mais para xG.
 *   Sofascore (a outra fonte autorizada) pode ter alternativa, mas ainda
 *   não confirmei se dá pra raspar direto sem JS -- por ora, futebol
 *   continua via Gemini.
 * - beisebol: sem provider configurado ainda.
 */
async function buscarStatsPorEsporte(esporte, { timeA, timeB }) {
  if (esporte === 'basquete') {
    try {
      return await buscarStatsBasquete(timeA, timeB);
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no scraper do basketball-reference (fail-open): ${erro.message}`);
      return null;
    }
  }

  if (esporte === 'futebol') {
    return investigarStats('futebol', timeA, timeB);
  }

  console.warn(`[SPORTS API] Sem provider de stats configurado para "${esporte}" -- seguindo sem stats (fail-open).`);
  return null;
}

module.exports = { buscarStatsPorEsporte };
