'use strict';

const { coletarPartidasDaRodada } = require('../../src/coletaRodada');
const { calcularQualidade } = require('../../src/filtroQualidade');
const { processarPartidaRadar } = require('../../src/radarProcessor');
const { montarRelatorioRodada } = require('../../src/relatorioBuilder');
const { publicarRelatorioNoGhost } = require('../../src/ghostService');

// TODO: trocar por um coletor real (Odds API + Sports API) antes de ativar o cron
// em produção. Ver src/coletaRodada.js para o formato esperado.
const { coletorPlaceholder } = require('../../src/coletorPlaceholder');

/**
 * GET /api/cron/relatorio-rodada
 *
 * Protegido por CRON_SECRET — a Vercel envia esse header automaticamente
 * quando o cron está configurado com "Authorization: Bearer $CRON_SECRET"
 * (ver vercel.json + variável de ambiente CRON_SECRET).
 */
module.exports = async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET;
  const auth = req.headers.authorization;

  if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }

  const inicio = Date.now();

  try {
    const { payloads, falhas: falhasColeta } = await coletarPartidasDaRodada({
      coletor: coletorPlaceholder,
    });

    const avaliacoes = payloads.map((payload) => ({
      payload,
      qualidade: calcularQualidade(payload),
    }));

    const aprovados = avaliacoes.filter((item) => item.qualidade.aprovado);
    const reprovados = avaliacoes.filter((item) => !item.qualidade.aprovado);

    const resultados = await Promise.all(
      aprovados.map((item) => processarPartidaRadar(item.payload))
    );

    const resultadosComSucesso = resultados.filter((resultado) => resultado.sucesso);
    const resultadosComFalha = resultados.filter((resultado) => !resultado.sucesso);

    const relatorio = montarRelatorioRodada(resultadosComSucesso, {
      totalAvaliado: payloads.length,
    });

    let publicacao = null;
    if (resultadosComSucesso.length > 0) {
      publicacao = await publicarRelatorioNoGhost(relatorio);
    }

    return res.status(200).json({
      sucesso: true,
      tempo_ms: Date.now() - inicio,
      resumo: {
        total_coletado: payloads.length,
        falhas_coleta: falhasColeta,
        aprovados_filtro_qualidade: aprovados.length,
        reprovados_filtro_qualidade: reprovados.map((item) => ({
          id_partida: item.payload?.evento?.id_partida,
          score: item.qualidade.score,
          motivos: item.qualidade.motivos,
        })),
        jogos_processados_com_sucesso: resultadosComSucesso.length,
        jogos_com_falha_na_gemini: resultadosComFalha.map((resultado) => ({
          id_partida: resultado.id_partida,
          etapa: resultado.etapa,
          erros: resultado.erros,
        })),
      },
      publicacao,
    });
  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: erro.message,
      tempo_ms: Date.now() - inicio,
    });
  }
};
