'use strict';

const db = require('../db');
const { publicarPickRadarNoGhost } = require('../ghostService');

/**
 * POST /api/scanner/publicar
 *
 * Publica UM pick do Radar (já casado com um fixture por /api/scanner/processar)
 * no Ghost, e grava o registro em palpites_publicados — cai automaticamente
 * na mesma camada de feedback que o fluxo Engine1/2 já usa (resultados.html,
 * ROI mensal, 5 do dia).
 *
 * Body esperado:
 * {
 *   "pick": { ...um item de picks_by_sport com "esporte" incluído... },
 *   "fixture": { "fixtureId": 123, "timeCasa": "...", "timeVisitante": "...", "ligaNome": "..." }
 * }
 *
 * Recusa publicar sem fixture_id — nunca aceita "publicar mesmo sem casar"
 * (decisão do produto: bloquear e esperar o cron, não improvisar).
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

  const pick = req.body?.pick;
  const fixture = req.body?.fixture;

  if (!pick || !pick.market || !pick.selection) {
    return res.status(400).json({ sucesso: false, erro: 'Body deve conter "pick" com ao menos market e selection.' });
  }
  if (!fixture?.fixtureId) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Pick sem fixture_id — rode /api/scanner/processar de novo, esse jogo ainda não foi casado com o banco.',
    });
  }

  let publicacao;
  try {
    publicacao = await publicarPickRadarNoGhost(pick, fixture);
  } catch (erro) {
    return res.status(502).json({ sucesso: false, erro: `Falha ao publicar no Ghost: ${erro.message}` });
  }

  try {
    await db.salvarPickRadarPublicado(pick, fixture, publicacao);
  } catch (erro) {
    // Mesma filosofia do analiserFixture.js — o post no Ghost já existe de
    // verdade, falha ao gravar o rastreamento não pode desfazer isso.
    // eslint-disable-next-line no-console
    console.warn('[scanner/publicar] falha ao salvar palpites_publicados:', erro.message);
  }

  try {
    await db.marcarFixtureAprovado(fixture.fixtureId, true);
  } catch (erro) {
    // eslint-disable-next-line no-console
    console.warn('[scanner/publicar] falha ao marcar fixture aprovado:', erro.message);
  }

  return res.status(200).json({ sucesso: true, ...publicacao });
};
