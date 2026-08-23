'use strict';
const db = require('../db');
const { analisarPickRadar } = require('../analiserPickRadar');
const { publicarPalpiteNoGhost } = require('../ghostService');

/**
 * POST /api/scanner/publicar
 *
 * Publica UM pick do Radar (já casado com um fixture por /api/scanner/processar)
 * no Ghost, e grava o registro em palpites_publicados.
 *
 * Antes de publicar, roda a esteira completa (analisarPickRadar: Gemini
 * investiga → Python calcula → Groq narra) — o pick bruto do Radar v3.0 não
 * traz mais odd/EV prontos (isso mudou na v3.0, ver Moneyball Radar v3.0),
 * então publicar o pick direto sem passar por aqui gera odd/EV undefined no
 * card. Se você já rodou /api/scanner/analisar separadamente pra esse pick
 * e só quer publicar o resultado pronto, mande "resultado_pronto" no body
 * (mesmo shape que analisarPickRadar devolve) pra pular a análise de novo.
 *
 * Body esperado:
 * {
 *   "pick": { "esporte": "...", "match": "...", "league": "...",
 *              "mercados_visiveis_no_print": [...], "contexto_ocr": "..." },
 *   "fixture": { "fixtureId": 123, "timeCasa": "...", "timeVisitante": "...", "ligaNome": "..." },
 *   "resultado_pronto": { ...opcional, saída de analisarPickRadar já calculada... }
 * }
 *
 * Recusa publicar sem fixture_id — nunca aceita "publicar mesmo sem casar"
 * (decisão do produto: bloquear e esperar o cron, não improvisar).
 */
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
  const pick = req.body?.pick;
  const fixture = req.body?.fixture;
  if (!pick?.esporte || !pick?.match) {
    return res.status(400).json({ sucesso: false, erro: 'Body deve conter "pick" com ao menos esporte e match.' });
  }
  if (!fixture?.fixtureId) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Pick sem fixture_id — rode /api/scanner/processar de novo, esse jogo ainda não foi casado com o banco.',
    });
  }

  const inicio = Date.now();

  // Se o resultado já veio pronto (analisado antes), reaproveita — evita
  // pagar Gemini/Groq de novo pelo mesmo jogo.
  let resultado = req.body?.resultado_pronto;
  if (!resultado?.sucesso) {
    resultado = await analisarPickRadar(fixture, pick, {
      geminiApiKey: req.body?.geminiApiKey,
      groqApiKey: req.body?.groqApiKey,
    });
    if (!resultado.sucesso) {
      return res.status(502).json({
        sucesso: false,
        erro: `Falha ao analisar o pick antes de publicar (etapa: ${resultado.etapa}).`,
        detalhes: resultado.erros,
        tempo_ms: Date.now() - inicio,
      });
    }
  }

  let publicacao;
  try {
    publicacao = await publicarPalpiteNoGhost(resultado);
  } catch (erro) {
    return res.status(502).json({ sucesso: false, erro: `Falha ao publicar no Ghost: ${erro.message}`, tempo_ms: Date.now() - inicio });
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
  return res.status(200).json({ sucesso: true, ...publicacao, tempo_ms: Date.now() - inicio });
};
