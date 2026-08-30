'use strict';

/**
 * Conectores de estatísticas por esporte. Futebol usa football-data.org,
 * basquete usa balldontlie.io. Beisebol ainda não tem provider de stats
 * configurado (sem chave na lista de env vars) -- devolve null nesse caso.
 *
 * NOTA: os endpoints/formatos exatos podem variar por plano de API;
 * confirme contra a documentação atual antes de produção. O objetivo aqui é
 * a interface e o encaixe no pipeline, não o mapeamento campo-a-campo final.
 */

async function buscarStatsFutebol({ timeA, timeB }) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY não configurada.');

  // football-data.org identifica times por ID, não por nome -- na prática
  // você provavelmente já tem (ou precisa de) um mapeamento nome -> id.
  // Aqui assumindo que timeA/timeB já chegam com o id resolvido a montante
  // (ex: em coletaRodada.js, ao casar evento da Odds API com o time no
  // provider de stats).
  console.warn('[SPORTS API] buscarStatsFutebol: confirme o mapeamento time->id do football-data.org antes de produção.');
  return null; // TODO: implementar a chamada real após resolver o mapeamento de IDs.
}

async function buscarStatsBasquete({ timeA, timeB }) {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error('BALLDONTLIE_API_KEY não configurada.');

  console.warn('[SPORTS API] buscarStatsBasquete: confirme o mapeamento time->id do balldontlie.io antes de produção.');
  return null; // TODO: implementar a chamada real após resolver o mapeamento de IDs.
}

async function buscarStatsPorEsporte(esporte, times) {
  if (esporte === 'futebol') return buscarStatsFutebol(times);
  if (esporte === 'basquete') return buscarStatsBasquete(times);
  console.warn(`[SPORTS API] Sem provider de stats configurado para "${esporte}" -- seguindo sem stats (fail-open).`);
  return null;
}

module.exports = { buscarStatsPorEsporte, buscarStatsFutebol, buscarStatsBasquete };
