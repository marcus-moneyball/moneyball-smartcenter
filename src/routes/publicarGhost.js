'use strict';
const { publicarPalpiteNoGhost, publicarRodadaNoGhost } = require('../ghostService');

/**
 * POST /api/publicar-ghost
 *'use strict';
const { publicarPalpiteNoGhost, publicarRodadaNoGhost } = require('../../api/ghostService');

/**
 * POST /api/publicar-ghost
 *
 * Recebe resultado(s) JÁ CALCULADO(S) (saída de gerarPalpitePartida, via
 * /api/rodar-rodada) e publica no Ghost. Não roda Engine 1/2 de novo — só
 * formata e publica o que você já tem.
 *
 * Body aceita DOIS formatos:
 *   1) Um jogo só:      { "resultado": { ...sucesso:true... } }
 *      → publica 1 post com esse jogo (publicarPalpiteNoGhost).
 *   2) Vários jogos:     { "resultados": [ { ...sucesso:true... }, ... ] }
 *      → publica 1 post ÚNICO com todos os jogos (publicarRodadaNoGhost) —
 *        usar isso pra economizar chamadas quando a rodada inteira (ex: os
 *        4-6 picks do Radar já casados+calculados) sai de uma vez.
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

  const { resultado, resultados } = req.body || {};

  try {
    if (Array.isArray(resultados)) {
      if (resultados.length === 0) {
        return res.status(400).json({ sucesso: false, erro: '"resultados" veio vazio.' });
      }
      const publicado = await publicarRodadaNoGhost(resultados);
      return res.status(200).json({ sucesso: true, ...publicado });
    }

    if (!resultado?.sucesso) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Body deve conter "resultado" (objeto, sucesso:true) ou "resultados" (array, ao menos 1 item com sucesso:true).',
      });
    }
    const publicado = await publicarPalpiteNoGhost(resultado);
    return res.status(200).json({ sucesso: true, ...publicado });
  } catch (erro) {
    return res.status(502).json({ sucesso: false, erro: erro.message });
  }
};
 * Recebe resultado(s) JÁ CALCULADO(S) (saída de gerarPalpitePartida, via
 * /api/rodar-rodada) e publica no Ghost. Não roda Engine 1/2 de novo — só
 * formata e publica o que você já tem.
 *
 * Body aceita DOIS formatos:
 *   1) Um jogo só:      { "resultado": { ...sucesso:true... } }
 *      → publica 1 post com esse jogo (publicarPalpiteNoGhost).
 *   2) Vários jogos:     { "resultados": [ { ...sucesso:true... }, ... ] }
 *      → publica 1 post ÚNICO com todos os jogos (publicarRodadaNoGhost) —
 *        usar isso pra economizar chamadas quando a rodada inteira (ex: os
 *        4-6 picks do Radar já casados+calculados) sai de uma vez.
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

  const { resultado, resultados } = req.body || {};

  try {
    if (Array.isArray(resultados)) {
      if (resultados.length === 0) {
        return res.status(400).json({ sucesso: false, erro: '"resultados" veio vazio.' });
      }
      const publicado = await publicarRodadaNoGhost(resultados);
      return res.status(200).json({ sucesso: true, ...publicado });
    }

    if (!resultado?.sucesso) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Body deve conter "resultado" (objeto, sucesso:true) ou "resultados" (array, ao menos 1 item com sucesso:true).',
      });
    }
    const publicado = await publicarPalpiteNoGhost(resultado);
    return res.status(200).json({ sucesso: true, ...publicado });
  } catch (erro) {
    return res.status(502).json({ sucesso: false, erro: erro.message });
  }
};
