'use strict';

const { buscarOddsPorEsporte } = require('./oddsApi');
const { buscarStatsPorEsporte } = require('./sportsApi');

async function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const { normalizarOdds } = require('./normalizarOdds');

/**
 * Substitui coletorPlaceholder.js. Busca eventos+odds na The Odds API para
 * cada esporte coberto e tenta enriquecer com stats do provider
 * correspondente. Segue o mesmo princípio fail-open de coletaRodada.js:
 * falha em UM evento (ex: stats não encontradas) não derruba a rodada --
 * o evento só entra com metricas_sports_api vazio, e o filtroQualidade.js
 * decide se isso é suficiente para aprová-lo.
 *
 * Formato de payload devolvido por evento (contrato de entrada esperado por
 * filtroQualidade.js / radarProcessor.js):
 *   {
 *     evento: { id_partida, esporte, time_a, time_b, liga, comeco_em },
 *     cotacoes_odds_api: { ... odds NORMALIZADAS, ver normalizarOdds.js ... },
 *     cotacoes_odds_api_bruto: { ... JSON cru da The Odds API, uso interno do radarProcessor ... },
 *     metricas_sports_api: { ... stats do time, se disponíveis ... } | null,
 *     pre_calculos_radar: { travas_automaticas: [...] } // TODO: calcular de fato
 *   }
 */
const ESPORTES_COBERTOS = ['futebol', 'basquete']; // beisebol fica de fora até ter provider de stats

async function coletorReal() {
  const payloads = [];

  for (const esporte of ESPORTES_COBERTOS) {
    let eventos;
    try {
      eventos = await buscarOddsPorEsporte(esporte);
    } catch (erro) {
      console.warn(`[COLETOR REAL] Falha ao buscar odds de ${esporte}: ${erro.message}`);
      continue;
    }

    for (const evento of eventos) {
      const idPartida = evento.id || `${evento.home_team}-${evento.away_team}-${evento.commence_time}`;
      const timeA = evento.home_team;
      const timeB = evento.away_team;

      let stats = null;
      try {
        stats = await buscarStatsPorEsporte(esporte, { timeA, timeB, sportKey: evento.sport_key });
      } catch (erro) {
        console.warn(`[COLETOR REAL] Partida ${idPartida}: falha ao buscar stats (${erro.message}) -- seguindo sem stats.`);
      }
      await esperar(300); // espaçamento entre chamadas ao Gemini -- evita picos de requisição

      payloads.push({
        evento: {
          id_partida: idPartida,
          esporte,
          time_a: timeA,
          time_b: timeB,
          liga: evento.sport_title || esporte,
          comeco_em: evento.commence_time,
        },
        cotacoes_odds_api: normalizarOdds(esporte, evento, timeA, timeB),
        cotacoes_odds_api_bruto: evento,
        metricas_sports_api: stats,
        // TODO: travas_automaticas é lógica pura de números (sem IA) que
        // ainda precisa ser definida -- ver filtroQualidade.js, que hoje só
        // checa se o campo está presente, não seu conteúdo.
        pre_calculos_radar: { travas_automaticas: [] },
      });
    }
  }

  // Contrato exigido por coletaRodada.js: o coletor devolve o array direto.
  // As falhas de validação estrutural por item são calculadas lá dentro,
  // não aqui.
  return payloads;
}

module.exports = { coletorReal };
