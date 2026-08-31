'use strict';

const { investigarStats } = require('./statsGemini');

/**
 * Ponto único de acesso a "stats por esporte" no pipeline. Antes tentava
 * calcular proxies a partir de football-data.org/balldontlie.io (gols
 * reais como aproximação de xG, saldo de pontos como aproximação de net
 * rating) -- trocado pela mesma técnica que o Pro já usa e valida em
 * produção: Gemini com Google Search Grounding restrito a fontes
 * confiáveis por esporte (ver statsGemini.js). Isso busca o dado real
 * publicado, em vez de aproximar.
 */
async function buscarStatsPorEsporte(esporte, { timeA, timeB }) {
  if (!['futebol', 'basquete', 'beisebol'].includes(esporte)) {
    console.warn(`[SPORTS API] Sem provider de stats configurado para "${esporte}" -- seguindo sem stats (fail-open).`);
    return null;
  }
  return investigarStats(esporte, timeA, timeB);
}

module.exports = { buscarStatsPorEsporte };
