'use strict';

const db = require('../db');

module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  try {
    const top5 = await db.obterTop5DoDia();

    // Bônus/opcional: mostra o que a múltipla combinada pagaria, sem
    // recomendar isso como o produto principal — variância de 5 jogos
    // independentes é muito mais alta que 5 apostas simples separadas.
    const oddCombinada = top5.reduce((acc, p) => acc * (p.odd ? Number(p.odd) : 1), 1);

    return res.status(200).json({
      sucesso: true,
      top5,
      multipla_bonus: top5.length > 0 ? { odd_combinada: Number(oddCombinada.toFixed(2)), aviso: 'Alta variância — cada entrada é de um jogo diferente e independente, não use isso como aposta principal.' } : null,
    });
  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
