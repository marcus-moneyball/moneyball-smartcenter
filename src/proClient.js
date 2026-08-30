'use strict';

/**
 * Cliente do Moneyball Pro -- único ponto do SmartCenter que fala com o
 * motor de cálculo (Poisson/EV/Kelly/roteiro/matchup). O SmartCenter NUNCA
 * duplica essa lógica em JS; ele só monta o payload de contexto e manda
 * pra cá.
 *
 * Requer as env vars:
 *   MONEYBALL_PRO_BASE_URL  -- ex: https://moneyballpro.vercel.app
 *   SMARTCENTER_SERVICE_KEY -- mesma chave configurada no Pro (X-Service-Key)
 */

const TIMEOUT_MS = 10_000;

/**
 * @param {Object} params
 * @param {string} params.esporte
 * @param {Object[]} params.mercados - mesmo formato que /api/v1/calc espera
 * @param {Object[]} [params.fatoresIncerteza] - sinais de contexto (Polymarket,
 *   tips, investigação do Gemini) no formato { tipo, descricao, impact_level }.
 *   Hoje o /api/v1/calc do Pro não recebe esse campo diretamente no payload
 *   principal -- ele é usado para enriquecer os dados de projeção antes de
 *   chegar aqui (ver radarProcessor.js). Mantido aqui só para log/depuração.
 * @returns {Promise<Object[]>} resultados de calcular_dossie
 */
async function calcularNoMoneyballPro({ esporte, mercados, fatoresIncerteza = [] }) {
  const baseUrl = process.env.MONEYBALL_PRO_BASE_URL;
  const serviceKey = process.env.SMARTCENTER_SERVICE_KEY;

  if (!baseUrl) {
    throw new Error('MONEYBALL_PRO_BASE_URL não configurada.');
  }
  if (!mercados || !Array.isArray(mercados) || mercados.length === 0) {
    throw new Error('calcularNoMoneyballPro: "mercados" vazio ou inválido.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/calc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(serviceKey ? { 'X-Service-Key': serviceKey } : {}),
      },
      body: JSON.stringify({ esporte, mercados }),
      signal: controller.signal,
    });

    if (!resposta.ok) {
      const corpoErro = await resposta.text().catch(() => '');
      throw new Error(`Pro respondeu ${resposta.status}: ${corpoErro.slice(0, 300)}`);
    }

    const dados = await resposta.json();
    if (fatoresIncerteza.length) {
      console.log(`[PRO CLIENT] ${fatoresIncerteza.length} fator(es) de contexto considerados na chamada.`);
    }
    return dados.resultados || [];
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { calcularNoMoneyballPro };
