'use strict';

/**
 * Monta o "relatório da rodada" já em HTML estilizado (não markdown) --
 * simplifica o ghostService.js (não precisa mais converter) e permite
 * efeitos visuais reais: badges coloridos por medalha, caixa de destaque
 * pra justificativa, tom visual diferente quando não há seleção.
 *
 * Estilos são inline de propósito (não classes CSS) -- garante que
 * renderiza igual independente do tema do Ghost, já que o post é
 * importado como HTML puro (source=html), não editado no editor nativo.
 *
 * Responsabilidade única: formatação. Nunca recalcula nada, nunca decide
 * o que entra ou não.
 */

const CORES_MEDALHA = {
  ouro: '#B8860B',
  prata: '#6B7280',
  bronze: '#B45309',
};

const FUNDO_MEDALHA = {
  ouro: '#FFF8E1',
  prata: '#F3F4F6',
  bronze: '#FDF0E3',
};

function formatarPosicao(chave, emoji, label, posicao) {
  const corMedalha = CORES_MEDALHA[chave];
  const fundoMedalha = FUNDO_MEDALHA[chave];

  if (!posicao || !posicao.selecao) {
    return `
      <div style="padding:12px 16px;margin:8px 0;border-radius:8px;background:#F9FAFB;color:#9CA3AF;font-size:14px;">
        ${emoji} <strong>${label}:</strong> sem seleção segura o suficiente nesta partida.
      </div>`;
  }

  const prob = posicao.probabilidade_estimada != null
    ? ` (${Math.round(posicao.probabilidade_estimada * 100)}%)`
    : '';

  return `
    <div style="padding:14px 18px;margin:10px 0;border-radius:8px;background:${fundoMedalha};border-left:4px solid ${corMedalha};">
      <div style="font-size:15px;color:${corMedalha};font-weight:700;margin-bottom:6px;">
        ${emoji} ${label}: ${posicao.mercado} — ${posicao.selecao} @ ${posicao.odd}${prob}
      </div>
      <div style="font-size:14px;color:#374151;line-height:1.5;">
        ${posicao.justificativa_curta ?? ''}
      </div>
    </div>`;
}

function formatarJogo(resultado) {
  const { confronto, liga, esporte, podio, alertas } = resultado;

  const cabecalhoJogo = `
    <h3 style="margin:24px 0 8px 0;font-size:18px;">
      ${confronto?.mandante} <span style="color:#9CA3AF;font-weight:400;">x</span> ${confronto?.visitante}
      <span style="color:#9CA3AF;font-weight:400;font-size:14px;"> — ${liga ?? esporte}</span>
    </h3>`;

  const posicoes = [
    formatarPosicao('ouro', '🥇', 'Ouro', podio?.ouro),
    formatarPosicao('prata', '🥈', 'Prata', podio?.prata),
    formatarPosicao('bronze', '🥉', 'Bronze', podio?.bronze),
  ].join('\n');

  const alertasHtml = alertas?.length
    ? `<div style="margin-top:8px;font-size:13px;color:#B45309;">⚠️ ${alertas.join('; ')}</div>`
    : '';

  return `${cabecalhoJogo}\n${posicoes}\n${alertasHtml}`;
}

/**
 * montarRelatorioRodada(resultadosAprovados, resumoExecucao)
 *
 * @param {Object[]} resultadosAprovados - saídas de processarPartidaRadar com sucesso:true,
 *   apenas para os jogos que passaram no filtro de qualidade.
 * @param {Object} resumoExecucao - metadados da rodada (total avaliado, nome do esporte)
 * @returns {{ titulo: string, html: string }}
 */
function montarRelatorioRodada(resultadosAprovados, resumoExecucao = {}) {
  const dataHoje = new Date().toISOString().slice(0, 10);
  const titulo = resumoExecucao.nomeEsporte
    ? `Relatório de ${resumoExecucao.nomeEsporte} da Rodada — ${dataHoje}`
    : `Relatório da Rodada — ${dataHoje}`;

  if (resultadosAprovados.length === 0) {
    return {
      titulo,
      html: `<p style="color:#6B7280;">Nenhum jogo passou no filtro de qualidade hoje (${resumoExecucao.totalAvaliado ?? 0} avaliados). Sem relatório para publicar.</p>`,
    };
  }

  const resumoHtml = `<p style="color:#6B7280;font-size:14px;">${resultadosAprovados.length} de ${resumoExecucao.totalAvaliado ?? resultadosAprovados.length} jogos avaliados passaram no filtro de qualidade.</p>`;

  const corpo = resultadosAprovados
    .map(formatarJogo)
    .join('\n<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">\n');

  return { titulo, html: `${resumoHtml}\n${corpo}` };
}

module.exports = { montarRelatorioRodada };
