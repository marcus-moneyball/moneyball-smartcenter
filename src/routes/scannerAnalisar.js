'use strict';

const { analisarPickRadar } = require('../analiserPickRadar');

/**
 * POST /api/scanner/analisar
 *
 * Roda a esteira completa (Gemini investiga → Python calcula → Groq narra)
 * pra UM pick já casado com um fixture (via /api/scanner/processar).
 * NÃO publica — devolve o resultado pra revisão antes de qualquer coisa ir
 * pro Ghost. Chamadas de IA custam tempo/dinheiro, então isso fica separado
 * do /api/scanner/publicar de propósito: você só paga o custo de IA nos
 * jogos que realmente casaram com o banco.
 *
 * Body esperado:
 * {
 *   "pick": { "esporte": "...", "match": "...", "league": "...",
 *              "mercados_visiveis_no_print": [...], "contexto_ocr": "..." },
 *   "fixture": { "fixtureId": 123, "timeCasa": "...", "timeVisitante": "...", "ligaNome": "..." }
 * }
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

  if (!pick?.esporte || !pick?.match) {
    return res.status(400).json({ sucesso: false, erro: 'Body deve conter "pick" com ao menos esporte e match.' });
  }
  if (!fixture?.fixtureId) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Pick sem fixture_id — rode /api/scanner/processar primeiro, esse jogo precisa estar casado com o banco.',
    });
  }

  const resultado = await analisarPickRadar(fixture, pick, {
    geminiApiKey: req.body?.geminiApiKey,
    groqApiKey: req.body?.groqApiKey,
  });

  const status = resultado.sucesso ? 200 : 502;
  return res.status(status).json({ ...resultado, fixture });
};
