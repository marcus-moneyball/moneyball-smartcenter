'use strict';

/**
 * Monta o "relatório da rodada": um único documento agregando o Pódio
 * (Ouro/Prata/Bronze) de todos os jogos que passaram no filtro de qualidade.
 * Responsabilidade única: formatação. Nunca recalcula nada, nunca decide
 * o que entra ou não — isso já veio pronto do filtro de qualidade e do
 * processarPartidaRadar.
 */

function formatarPosicao(label, posicao) {
  if (!posicao || !posicao.selecao) {
    return `**${label}:** sem seleção segura o suficiente nesta partida.`;
  }
  const prob = posicao.probabilidade_estimada != null
    ? ` (${Math.round(posicao.probabilidade_estimada * 100)}%)`
    : '';
  return `**${label}:** ${posicao.mercado} — ${posicao.selecao} @ ${posicao.odd}${prob}\n> ${posicao.justificativa_curta ?? ''}`;
}

function formatarJogo(resultado) {
  const { confronto, liga, esporte, podio, alertas } = resultado;
  const titulo = `### ${confronto?.mandante} x ${confronto?.visitante} — ${liga ?? esporte}`;

  const linhas = [
    titulo,
    formatarPosicao('🥇 Ouro', podio?.ouro),
    formatarPosicao('🥈 Prata', podio?.prata),
    formatarPosicao('🥉 Bronze', podio?.bronze),
  ];

  if (alertas?.length) {
    linhas.push(`\n_Alertas: ${alertas.join('; ')}_`);
  }

  return linhas.join('\n\n');
}

/**
 * montarRelatorioRodada(resultadosAprovados, resumoExecucao)
 *
 * @param {Object[]} resultadosAprovados - saídas de processarPartidaRadar com sucesso:true,
 *   apenas para os jogos que passaram no filtro de qualidade.
 * @param {Object} resumoExecucao - metadados da rodada (total avaliado, total aprovado, descartados)
 * @returns {{ titulo: string, markdown: string }}
 */
function montarRelatorioRodada(resultadosAprovados, resumoExecucao = {}) {
  const dataHoje = new Date().toISOString().slice(0, 10);
  const titulo = `Relatório da Rodada — ${dataHoje}`;

  if (resultadosAprovados.length === 0) {
    return {
      titulo,
      markdown: `## ${titulo}\n\nNenhum jogo passou no filtro de qualidade hoje (${resumoExecucao.totalAvaliado ?? 0} avaliados). Sem relatório para publicar.`,
    };
  }

  const cabecalho = `## ${titulo}\n\n${resultadosAprovados.length} de ${resumoExecucao.totalAvaliado ?? resultadosAprovados.length} jogos avaliados passaram no filtro de qualidade.`;

  const corpo = resultadosAprovados.map(formatarJogo).join('\n\n---\n\n');

  return { titulo, markdown: `${cabecalho}\n\n---\n\n${corpo}` };
}

module.exports = { montarRelatorioRodada };
