'use strict';

/**
 * Conector do Polymarket -- PENDÊNCIA: ainda sem API/chave definida.
 *
 * Quando estiver pronto, esta função deve devolver a probabilidade
 * implícita do mercado preditivo para o evento (ex: "time A vence"), no
 * formato abaixo, para o contextInvestigator comparar com a odd do
 * sportsbook e gerar o fator_incerteza de divergência.
 *
 * Formato esperado de retorno (quando implementado):
 *   { probabilidade_implicita: { time_a: 0.62, time_b: 0.38 }, volume_usd: 12000, url_mercado: "..." }
 *   ou null se não houver mercado equivalente para o evento.
 *
 * Fail-open: enquanto não implementado, sempre devolve null -- o resto do
 * pipeline (contextInvestigator, radarProcessor) já trata isso como
 * "sem dado de Polymarket disponível" sem quebrar a rodada.
 */
async function buscarPolymarket({ timeA, timeB, esporte }) {
  if (!process.env.POLYMARKET_API_KEY) {
    return null;
  }

  // TODO: implementar a chamada real assim que a API/chave for definida.
  console.warn('[POLYMARKET] Chave configurada mas conector ainda não implementado.');
  return null;
}

module.exports = { buscarPolymarket };
