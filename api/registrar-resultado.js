'use strict';

const db = require('../src/db');

/**
 * GET  /api/registrar-resultado — lista palpites pendentes dos últimos 7 dias
 * POST /api/registrar-resultado — body: { id, resultado: 'ganhou'|'perdeu'|'push' }
 */
module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  if (req.method === 'GET') {
    try {
      const pendentes = await db.listarPalpitesPendentes();
      return res.status(200).json({ sucesso: true, pendentes });
    } catch (erro) {
      return res.status(500).json({ sucesso: false, erro: erro.message });
    }
  }

  if (req.method === 'POST') {
    const { id, resultado } = req.body || {};
    if (!id || !['ganhou', 'perdeu', 'push'].includes(resultado)) {
      return res.status(400).json({ sucesso: false, erro: 'Body deve conter "id" e "resultado" (ganhou|perdeu|push).' });
    }

    try {
      await db.atualizarResultadoPalpite(id, resultado);
      return res.status(200).json({ sucesso: true });
    } catch (erro) {
      return res.status(500).json({ sucesso: false, erro: erro.message });
    }
  }

  return res.status(405).json({ sucesso: false, erro: 'Use GET ou POST.' });
};
