'use strict';
const { analisarPickRadar } = require('../analiserPickRadar');
const { publicarRodadaNoGhost } = require('../ghostService');
const db = require('../db');

/**
 * POST /api/scanner/publicar-rodada
 *
 * Roda a esteira completa (Gemini investiga → Python calcula → Groq narra,
 * via analisarPickRadar) pra CADA pick "pronto" recebido, e publica TODOS
 * os jogos que derem certo num ÚNICO post no Ghost (publicarRodadaNoGhost)
 * — em vez de 1 chamada de publish por jogo.
 *
 * Existe ao lado de /api/scanner/publicar (que continua servindo pra
 * publicar 1 pick isolado, se um dia for preciso) e substitui o fluxo de
 * "analisar um por um e publicar um por um" quando a rodada inteira (os
 * itens "pronto" que /api/scanner/processar devolveu) sai de uma vez.
 *
 * Body esperado — o array "itens" que /api/scanner/processar devolve
 * (pode mandar todos, prontos e bloqueados; os bloqueados são ignorados):
 * {
 *   "itens": [
 *     { "pick": {...}, "status": "pronto", "fixture": {"fixtureId": 123, ...} },
 *     ...
 *   ]
 * }
 *
 * Roda em SÉRIE de propósito (mesmo motivo do rodar-rodada.js: evitar
 * estourar rate limit do Gemini/Groq). Em compensação, com vários jogos
 * isso pode se aproximar do teto de 60s do plano Hobby — se acontecer,
 * mande os itens em 2 lotes menores em vez de todos de uma vez.
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

  const itens = req.body?.itens;
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ sucesso: false, erro: 'Body deve conter "itens": o array que /api/scanner/processar devolveu.' });
  }

  const prontos = itens.filter((i) => i?.status === 'pronto' && i?.fixture?.fixtureId && i?.pick);
  if (prontos.length === 0) {
    return res.status(400).json({ sucesso: false, erro: 'Nenhum item "pronto" com fixture e pick — rode /api/scanner/processar primeiro.' });
  }

  const inicio = Date.now();

  // Roda em série — mesmo cuidado de rate limit do rodar-rodada.js.
  const analisados = [];
  for (const item of prontos) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await analisarPickRadar(item.fixture, item.pick, {
      geminiApiKey: req.body?.geminiApiKey,
      groqApiKey: req.body?.groqApiKey,
    });
    analisados.push({ pick: item.pick, fixture: item.fixture, resultado });
  }

  const comSucesso = analisados.filter((a) => a.resultado.sucesso);
  const comFalha = analisados.filter((a) => !a.resultado.sucesso);

  if (comSucesso.length === 0) {
    return res.status(502).json({
      sucesso: false,
      erro: 'Nenhum pick foi analisado com sucesso — nada pra publicar.',
      falhas: comFalha.map((a) => ({ match: a.pick.match, etapa: a.resultado.etapa, erros: a.resultado.erros })),
      tempo_ms: Date.now() - inicio,
    });
  }

  let publicacao;
  try {
    publicacao = await publicarRodadaNoGhost(comSucesso.map((a) => a.resultado));
  } catch (erro) {
    return res.status(502).json({
      sucesso: false,
      erro: `Análise ok, mas falhou ao publicar no Ghost: ${erro.message}`,
      tempo_ms: Date.now() - inicio,
    });
  }

  // Bookkeeping por jogo (ROI mensal, 5 do dia) — mesma filosofia do
  // scanner/publicar.js: o post já existe de verdade, falha aqui não desfaz isso.
  for (const item of comSucesso) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.salvarPickRadarPublicado(item.pick, item.fixture, publicacao);
      // eslint-disable-next-line no-await-in-loop
      await db.marcarFixtureAprovado(item.fixture.fixtureId, true);
    } catch (erro) {
      // eslint-disable-next-line no-console
      console.warn('[scanner/publicar-rodada] falha ao gravar bookkeeping de um jogo:', erro.message);
    }
  }

  return res.status(200).json({
    sucesso: true,
    tempo_ms: Date.now() - inicio,
    post: publicacao,
    resumo: {
      recebidos: itens.length,
      prontos: prontos.length,
      analisados_com_sucesso: comSucesso.length,
      analisados_com_falha: comFalha.length,
    },
    falhas: comFalha.map((a) => ({ match: a.pick.match, etapa: a.resultado.etapa, erros: a.resultado.erros })),
  });
};
