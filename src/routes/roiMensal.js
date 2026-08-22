'use strict';

const db = require('../db');

/**
 * GET /api/roi-mensal?ano=2026&mes=8
 * Se não passar ano/mes, usa o mês atual.
 */
module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  const agora = new Date();
  const ano = Number(req.query?.ano) || agora.getFullYear();
  const mes = Number(req.query?.mes) || agora.getMonth() + 1;

  try {
    const linhas = await db.obterRoiMensal(ano, mes);

    const unidadesApostadas = linhas.reduce((acc, l) => acc + Number(l.unidades_totais || 0), 0);
    const unidadesGanhas = linhas.reduce((acc, l) => acc + Number(l.unidades_ganhas || 0), 0);
    const unidadesPerdidas = linhas.reduce((acc, l) => acc + Number(l.unidades_perdidas || 0), 0);
    const saldo = unidadesGanhas - unidadesPerdidas;
    const roi = unidadesApostadas > 0 ? (saldo / unidadesApostadas) * 100 : null;

    return res.status(200).json({
      sucesso: true,
      ano,
      mes,
      detalhe_por_resultado: linhas,
      resumo: {
        unidades_apostadas: Number(unidadesApostadas.toFixed(2)),
        unidades_ganhas: Number(unidadesGanhas.toFixed(2)),
        unidades_perdidas: Number(unidadesPerdidas.toFixed(2)),
        saldo_unidades: Number(saldo.toFixed(2)),
        roi_percentual: roi !== null ? Number(roi.toFixed(2)) : null,
      },
    });
  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
