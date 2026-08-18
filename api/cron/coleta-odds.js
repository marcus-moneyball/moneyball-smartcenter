'use strict';

const { rodarColetaOddsApi } = require('../../src/coletaOddsApi');

/**
 * GET /api/cron/coleta-odds
 * Disparado pela Vercel Cron — 1x/dia, madrugada (ver vercel.json).
 */
module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  try {
    const resultado = await rodarColetaOddsApi();
    return res.status(200).json(resultado);
  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
