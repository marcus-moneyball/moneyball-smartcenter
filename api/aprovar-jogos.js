'use strict';

const { analisarEPublicarFixture } = require('../src/analiserFixture');

// Vercel mata a função em 10s por padrão — nosso retry de rate limit (429)
// sozinho pode levar até ~40s. 60s é o teto do plano Hobby.
module.exports.config = { maxDuration: 60 };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false, erro: 'Use POST.' });
  }

  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  const fixtureIds = req.body?.fixture_ids;
  if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) {
    return res.status(400).json({ sucesso: false, erro: 'Body deve conter "fixture_ids": array não vazio.' });
  }

  const resultados = [];
  for (const fixtureId of fixtureIds) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await analisarEPublicarFixture(fixtureId);
    resultados.push(resultado);
  }

  return res.status(200).json({
    sucesso: true,
    total: resultados.length,
    resultados,
  });
};
