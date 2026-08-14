'use strict';

/**
 * coletorPlaceholder()
 *
 * ⚠️ PENDÊNCIA: isto é um placeholder. Devolve array vazio de propósito,
 * pra o cron rodar sem erro mas sem publicar nada até você conectar os
 * providers reais (The Odds API para cotações + provider de estatísticas
 * por esporte).
 *
 * Quando for implementar de verdade, esta função deve:
 *   1. Buscar os eventos do dia (Odds API, endpoint de eventos)
 *   2. Para cada evento, buscar cotações (Odds API, endpoint de odds)
 *   3. Para cada evento, buscar estatísticas do provider do esporte correspondente
 *   4. Calcular pre_calculos_radar (lambda_total, travas_automaticas) — lógica
 *      pura de números, sem IA
 *   5. Montar e devolver o array de payloads no formato do contrato de entrada
 */
async function coletorPlaceholder() {
  // eslint-disable-next-line no-console
  console.warn(
    '[coletorPlaceholder] Nenhum provider real conectado ainda — devolvendo rodada vazia.'
  );
  return [];
}

module.exports = { coletorPlaceholder };
