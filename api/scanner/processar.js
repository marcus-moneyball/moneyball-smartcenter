'use strict';

const { buscarFixtureParaPick } = require('../../src/radarMatcher');

/**
 * POST /api/scanner/processar
 *
 * Recebe o JSON completo do Moneyball Radar v2.1 (picks_by_sport) e, pra
 * cada pick, tenta casar com um fixture real já coletado pelo cron.
 *
 * NUNCA publica nada aqui — só diz "pronto" (achou fixture, pode publicar)
 * ou "bloqueado" (não achou — cron ainda não coletou, ou liga fora da
 * whitelist gratuita). A decisão de publicar é sempre um passo separado e
 * explícito em /api/scanner/publicar, um pick por vez.
 *
 * Body esperado: o JSON inteiro que o Radar devolve (radar_metadata,
 * resumo_rodada, picks_by_sport).
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

  const picksBySport = req.body?.picks_by_sport;
  if (!picksBySport || typeof picksBySport !== 'object') {
    return res.status(400).json({ sucesso: false, erro: 'Body deve conter "picks_by_sport" (JSON do Radar v2.1).' });
  }

  const itensProcessados = [];

  for (const [esporte, picks] of Object.entries(picksBySport)) {
    if (!Array.isArray(picks)) continue;

    for (const pick of picks) {
      // eslint-disable-next-line no-await-in-loop
      const match = await buscarFixtureParaPick({ esporte, match: pick.match, league: pick.league });

      itensProcessados.push({
        pick: { ...pick, esporte },
        status: match.encontrado ? 'pronto' : 'bloqueado',
        motivo_bloqueio: match.encontrado ? null : match.motivo,
        fixture: match.encontrado
          ? {
              fixtureId: match.fixtureId,
              timeCasa: match.timeCasa,
              timeVisitante: match.timeVisitante,
              ligaNome: match.ligaNome,
              dataHora: match.dataHora,
            }
          : null,
      });
    }
  }

  return res.status(200).json({
    sucesso: true,
    resumo_rodada: req.body?.resumo_rodada ?? null,
    radar_metadata: req.body?.radar_metadata ?? null,
    total: itensProcessados.length,
    prontos: itensProcessados.filter((i) => i.status === 'pronto').length,
    bloqueados: itensProcessados.filter((i) => i.status === 'bloqueado').length,
    itens: itensProcessados,
  });
};
