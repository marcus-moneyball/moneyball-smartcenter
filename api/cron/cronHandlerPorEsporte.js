'use strict';

const { coletarPartidasDaRodada } = require('../coletaRodada');
const { calcularQualidade } = require('../filtroQualidade');
const { processarPartidaRadar } = require('../radarProcessor');
const { montarRelatorioRodada } = require('../relatorioBuilder');
const { publicarRelatorioNoGhost } = require('../ghostService');
const { criarColetorReal } = require('../coletores/coletorReal');

/**
 * Handler compartilhado pelos 3 crons por esporte (relatorio-futebol.js,
 * relatorio-basquete.js, relatorio-beisebol.js). Cada um só passa qual(is)
 * esporte(s) e o nome de exibição -- toda a lógica de coleta/filtro/cálculo/
 * publicação é idêntica, só o escopo de esporte muda.
 *
 * @param {string[]} esportesAlvo - ex: ['futebol']
 * @param {string} nomeEsporte - rótulo pro título do relatório, ex: 'Futebol'
 */
function criarHandlerPorEsporte(esportesAlvo, nomeEsporte) {
  const coletor = criarColetorReal(esportesAlvo);

  return async function handler(req, res) {
    const segredoEsperado = process.env.CRON_SECRET;
    const auth = req.headers.authorization;

    if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
      return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
    }

    const inicio = Date.now();

    try {
      const { payloads, falhas: falhasColeta } = await coletarPartidasDaRodada({ coletor });

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
        nomeEsporte,
      });

      let publicacao = null;
      if (resultadosComSucesso.length > 0) {
        publicacao = await publicarRelatorioNoGhost(relatorio);
      }

      return res.status(200).json({
        sucesso: true,
        esporte: nomeEsporte,
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
        esporte: nomeEsporte,
        erro: erro.message,
        tempo_ms: Date.now() - inicio,
      });
    }
  };
}

module.exports = { criarHandlerPorEsporte };
