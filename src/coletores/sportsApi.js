'use strict';

const { investigarStats } = require('./statsGemini');
const { buscarStatsBasquete } = require('./statsBasketballReference');
const { buscarStatsFutebol: buscarStatsFutebolUnderstat } = require('./statsUnderstat');

/**
 * Ponto único de acesso a "stats por esporte" no pipeline.
 *
 * - basquete: scraper direto do basketball-reference.com -- grátis, sem
 *   Gemini, dado real (net rating).
 * - futebol: tenta o Understat.com primeiro (grátis, xG real) -- só cai
 *   pro Gemini com grounding (pago) se o time não for encontrado lá (ex:
 *   liga que o Understat não cobre). Isso deve eliminar a maior parte do
 *   custo de Gemini que ainda tínhamos.
 * - beisebol: sem provider configurado ainda.
 */
async function buscarStatsPorEsporte(esporte, { timeA, timeB, sportKey }) {
  if (esporte === 'basquete') {
    try {
      return await buscarStatsBasquete(timeA, timeB, sportKey);
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no scraper do basketball-reference (fail-open): ${erro.message}`);
      return null;
    }
  }

  if (esporte === 'futebol') {
    try {
      const viaUnderstat = await buscarStatsFutebolUnderstat(timeA, timeB, sportKey);
      if (viaUnderstat) return viaUnderstat;
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no scraper do Understat (caindo pro Gemini): ${erro.message}`);
    }
    // Fallback: Understat não cobriu (liga fora de escopo, time não encontrado, ou erro).
    return investigarStats('futebol', timeA, timeB);
  }

  console.warn(`[SPORTS API] Sem provider de stats configurado para "${esporte}" -- seguindo sem stats (fail-open).`);
  return null;
}

module.exports = { buscarStatsPorEsporte };
