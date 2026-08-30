'use strict';

/**
 * Conector de tips de tipsters -- PENDÊNCIA: fonte ainda não definida
 * (Telegram foi cogitado e depois removido do escopo do SmartCenter).
 *
 * Quando a fonte for escolhida (feed RSS, scraping de site, API de terceiro,
 * etc.), esta função deve devolver as tips relevantes para o evento no
 * formato abaixo, para o contextInvestigator (Gemini) interpretar:
 *
 *   [{ autor: string, texto: string, selecao_sugerida: string|null, data: string }]
 *
 * Fail-open: enquanto não implementado, sempre devolve array vazio.
 */
async function buscarTips({ timeA, timeB, esporte }) {
  // TODO: plugar a fonte real (feed de tipsters) aqui.
  return [];
}

module.exports = { buscarTips };
