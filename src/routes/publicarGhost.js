'use strict';

const { publicarPalpiteNoGhost } = require('../ghostService');

/**
 * POST /api/publicar-ghost
 *
 * Recebe um resultado JÁ CALCULADO (a saída de /api/rodar-rodada, um item
 * de "resultados") e publica como rascunho no Ghost. Não roda Engine 1/2 de
 * novo — só formata e publica o que você já tem.
 *
 * Body esperado: { "resultado": { ...objeto com sucesso:true... } }
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

  const resultado = req.body?.resultado;
  if (!resultado?.sucesso) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Body deve conter "resultado": um objeto com sucesso:true (saída do Engine 1+2).',
    });
  }

  try {
    const publicado = await publicarPalpiteNoGhost(resultado);
    return res.status(200).json({ sucesso: true, ...publicado });
  } catch (erro) {
    return res.status(502).json({ sucesso: false, erro: erro.message });
  }
};
