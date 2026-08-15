'use strict';

const { gerarPalpitePartida } = require('../src/palpiteOrchestrator');

/**
 * POST /api/rodar-rodada
 *
 * Endpoint manual — você informa os jogos que quer analisar, sem depender
 * do cron nem da coleta automática do Radar (ainda não implementada).
 *
 * Body esperado:
 * {
 *   "jogos": [
 *     { "esporte": "futebol", "casa": "Flamengo", "visitante": "Palmeiras", "liga": "Brasileirão" },
 *     { "esporte": "beisebol", "casa": "Yankees", "visitante": "Red Sox", "liga": "MLB" }
 *   ]
 * }
 *
 * Protegido pelo mesmo CRON_SECRET (Authorization: Bearer <valor>) — não é
 * exclusivo de cron, é só reaproveitar o segredo que você já configurou.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false, erro: 'Use POST.' });
  }

  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  const jogos = req.body?.jogos;
  if (!Array.isArray(jogos) || jogos.length === 0) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Body deve conter "jogos": um array não vazio de { esporte, casa, visitante, liga? }.',
    });
  }

  const inicio = Date.now();

  // Roda em série (não paralelo) de propósito — evita estourar rate limit
  // do Gemini/Groq quando a lista de jogos for grande.
  const resultados = [];
  for (const jogo of jogos) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await gerarPalpitePartida(jogo);
    resultados.push(resultado);
  }

  const comSucesso = resultados.filter((r) => r.sucesso);
  const comFalha = resultados.filter((r) => !r.sucesso);

  return res.status(200).json({
    sucesso: true,
    tempo_ms: Date.now() - inicio,
    resumo: {
      total: resultados.length,
      sucesso: comSucesso.length,
      falha: comFalha.length,
    },
    resultados,
  });
};
