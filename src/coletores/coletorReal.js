'use strict';

const { buscarOddsPorEsporte } = require('./oddsApi');
const { buscarStatsPorEsporte } = require('./sportsApi');

async function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const { normalizarOdds } = require('./normalizarOdds');
const { calcularIndiceRelevancia } = require('./calcularRelevancia');

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

// Limite de quantas partidas recebem a investigação de stats (Gemini) por
// rodada. Isso existe por causa de duas restrições reais, não é um número
// arbitrário de "otimização prematura":
//   1. Plano Hobby da Vercel corta a function em 60s -- 62 chamadas ao
//      Gemini (grounding, ~1-3s cada) não cabem nesse tempo.
//   2. Plano gratuito do Gemini permite só 5-15 req/min -- 62 de uma vez
//      estoura a cota (foi exatamente o erro 429 que apareceu no teste).
// Como só as 3 melhores (Pódio Ouro/Prata/Bronze) importam no relatório
// final, não faz sentido gastar Gemini nas 62 -- só nas com maior índice
// de relevância (calcularRelevancia.js: micro-assimetria de domínio +
// expectativa de pontuação, calculado sem nenhuma chamada de API).
const LIMITE_STATS_POR_RODADA = Number(process.env.LIMITE_STATS_POR_RODADA) || 5;

async function coletorReal() {
  const candidatos = [];

  // --- Etapa 1: coleta de odds pra TODOS os eventos (rápida, sem Gemini) ---
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
      const oddsNormalizadas = normalizarOdds(esporte, evento, timeA, timeB);

      candidatos.push({
        evento: {
          id_partida: idPartida,
          esporte,
          time_a: timeA,
          time_b: timeB,
          liga: evento.sport_title || esporte,
          comeco_em: evento.commence_time,
        },
        cotacoes_odds_api: oddsNormalizadas,
        cotacoes_odds_api_bruto: evento,
        _scoreOddsParaRanking: calcularIndiceRelevancia(evento.sport_key, evento),
      });
    }
  }

  // --- Etapa 2: escolher só as melhores candidatas pra investigar stats ---
  candidatos.sort((a, b) => b._scoreOddsParaRanking - a._scoreOddsParaRanking);
  const investigarStatsIds = new Set(
    candidatos.slice(0, LIMITE_STATS_POR_RODADA).map((c) => c.evento.id_partida)
  );

  console.log(
    `[COLETOR REAL] ${candidatos.length} partidas coletadas; investigando stats só nas ${investigarStatsIds.size} com melhor cobertura de odds.`
  );

  // --- Etapa 3: investigar stats (Gemini) só nas escolhidas ---
  const payloads = [];
  for (const candidato of candidatos) {
    let stats = null;

    if (investigarStatsIds.has(candidato.evento.id_partida)) {
      try {
        stats = await buscarStatsPorEsporte(candidato.evento.esporte, {
          timeA: candidato.evento.time_a,
          timeB: candidato.evento.time_b,
          sportKey: candidato.cotacoes_odds_api_bruto.sport_key,
        });
      } catch (erro) {
        console.warn(`[COLETOR REAL] Partida ${candidato.evento.id_partida}: falha ao buscar stats (${erro.message}) -- seguindo sem stats.`);
      }
      await esperar(1200); // espaçamento leve -- Tier 1 (faturamento) tem RPM bem mais folgado que o gratuito
    }

    const { _scoreOddsParaRanking, ...payloadLimpo } = candidato;
    payloads.push({
      ...payloadLimpo,
      metricas_sports_api: stats,
      // TODO: travas_automaticas é lógica pura de números (sem IA) que
      // ainda precisa ser definida -- ver filtroQualidade.js, que hoje só
      // checa se o campo está presente, não seu conteúdo.
      pre_calculos_radar: { travas_automaticas: [] },
    });
  }

  // Contrato exigido por coletaRodada.js: o coletor devolve o array direto.
  // As falhas de validação estrutural por item são calculadas lá dentro,
  // não aqui.
  return payloads;
}

module.exports = { coletorReal };
