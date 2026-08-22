'use strict';

const db = require('../db');
const { rankearFixturesPorHype } = require('../hypeScore');

module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  try {
    const fixtures = await db.obterFixturesDoDiaComOdds();
    const ranqueados = rankearFixturesPorHype(fixtures);
    return res.status(200).json({ sucesso: true, total: ranqueados.length, jogos: ranqueados });
  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
