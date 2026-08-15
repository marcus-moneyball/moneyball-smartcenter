'use strict';

/**
 * coletarPartidasDaRodada()
 *
 * PENDÊNCIA CONHECIDA: este módulo é a fronteira entre o Radar Engine e as
 * fontes de dados reais (The Odds API para cotações, provider de estatísticas
 * por esporte). Ele deve devolver um array de payloads já no formato do
 * contrato de entrada (evento/cotacoes_odds_api/metricas_sports_api/
 * pre_calculos_radar) — o mesmo shape que processarPartidaRadar espera.
 *
 * Por enquanto expõe um adaptador simples: você passa uma função de coleta
 * real (assíncrona) e este módulo só garante o formato de retorno e loga
 * falhas por jogo sem derrubar a rodada inteira (Fail-Open, mesmo princípio
 * usado no Radar do Cortex).
 *
 * Uso esperado, quando os providers reais estiverem prontos:
 *   const partidas = await coletarPartidasDaRodada({ coletor: meuColetorReal });
 */

/**
 * @param {Object} opcoes
 * @param {() => Promise<Object[]>} opcoes.coletor - função que efetivamente
 *   busca eventos + odds + estatísticas e devolve os payloads brutos.
 *   OBRIGATÓRIO — sem isso não há como saber quais jogos existem na rodada.
 * @returns {Promise<{ payloads: Object[], falhas: string[] }>}
 */
async function coletarPartidasDaRodada({ coletor } = {}) {
  if (typeof coletor !== 'function') {
    throw new Error(
      'coletarPartidasDaRodada: nenhum "coletor" foi fornecido. ' +
        'Implemente a busca real via Odds API + Sports API e passe a função aqui — ' +
        'este módulo não inventa dados de partidas.'
    );
  }

  let payloadsBrutos;
  try {
    payloadsBrutos = await coletor();
  } catch (erro) {
    throw new Error(`Falha ao coletar partidas da rodada: ${erro.message}`);
  }

  if (!Array.isArray(payloadsBrutos)) {
    throw new Error('O coletor deve devolver um array de payloads de partida.');
  }

  const payloads = [];
  const falhas = [];

  for (const payload of payloadsBrutos) {
    const idPartida = payload?.evento?.id_partida ?? '(sem id)';
    if (!payload?.evento?.esporte) {
      falhas.push(`Partida ${idPartida} descartada: sem "evento.esporte".`);
      continue;
    }
    payloads.push(payload);
  }

  return { payloads, falhas };
}

module.exports = { coletarPartidasDaRodada };
