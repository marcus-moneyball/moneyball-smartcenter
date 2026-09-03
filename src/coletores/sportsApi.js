'use strict';

const { investigarStats } = require('./statsGemini');
const { buscarStatsBasquete } = require('./statsBasketballReference');
const { buscarStatsFutebol: buscarStatsFutebolUnderstat } = require('./statsUnderstat');

/**
 * Ponto único de acesso a "stats por esporte" no pipeline.
 *
 * MUDANÇA IMPORTANTE: os dois scrapers gratuitos (Understat, Basketball-
 * Reference) se mostraram não-confiáveis a partir de uma function
 * serverless: o Understat reestruturou o site (não embute mais os dados
 * numa variável JS simples), e o Basketball-Reference bloqueia a Vercel com
 * um desafio anti-bot (Cloudflare) -- confirmado via teste direto, não é
 * mais suposição. Ambos ainda são tentados primeiro (baixo custo, às vezes
 * funcionam), mas o Gemini agora é o fallback real e esperado pros dois
 * esportes, não uma exceção rara.
 */
async function buscarStatsPorEsporte(esporte, { timeA, timeB, sportKey }) {
  if (esporte === 'basquete') {
    try {
      const viaScraper = await buscarStatsBasquete(timeA, timeB, sportKey);
      if (viaScraper) return viaScraper;
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no scraper do basketball-reference (caindo pro Gemini): ${erro.message}`);
    }
    return investigarStats('basquete', timeA, timeB);
  }

  if (esporte === 'futebol') {
    try {
      const viaUnderstat = await buscarStatsFutebolUnderstat(timeA, timeB, sportKey);
      if (viaUnderstat) return viaUnderstat;
    } catch (erro) {
      console.warn(`[SPORTS API] Falha no scraper do Understat (caindo pro Gemini): ${erro.message}`);
    }
    return investigarStats('futebol', timeA, timeB);
  }

  if (esporte === 'beisebol') {
    return investigarStats('beisebol', timeA, timeB);
  }

  console.warn(`[SPORTS API] Sem provider de stats configurado para "${esporte}" -- seguindo sem stats (fail-open).`);
  return null;
}

module.exports = { buscarStatsPorEsporte };
