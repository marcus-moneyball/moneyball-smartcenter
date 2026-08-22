'use strict';

const { rodarColetaNoturna } = require('../coletaNoturna');

/**
 * GET /api/cron/coleta-noturna
 * Disparado automaticamente pela Vercel Cron (ver vercel.json).
 */
module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  try {
    const resultado = await rodarColetaNoturna();
    return res.status(200).json(resultado);
  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
