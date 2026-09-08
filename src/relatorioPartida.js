'use strict';

/**
 * Monta o HTML do artigo de UMA partida. Responsabilidade única:
 * formatação -- nunca recalcula, nunca decide o que é destaque (isso já
 * vem pronto de fora).
 */

function formatarTabelaOdds(mercadosVisiveis) {
  const linhas = mercadosVisiveis
    .map(
      (m) => `
      <div style="display:flex;padding:8px 12px;border-bottom:1px solid #E5E7EB;">
        <div style="flex:1;">${m.mercado}</div>
        <div style="flex:1;">${m.selecao}</div>
        <div style="width:80px;text-align:right;">${m.odd}</div>
      </div>`
    )
    .join('\n');

  return `
    <div style="margin:16px 0;font-size:14px;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
      <div style="display:flex;padding:8px 12px;background:#F9FAFB;font-weight:600;">
        <div style="flex:1;">Mercado</div>
        <div style="flex:1;">Seleção</div>
        <div style="width:80px;text-align:right;">Odd</div>
      </div>
      ${linhas}
    </div>`;
}

function formatarDestaques(destaques) {
  if (!destaques.length) {
    return `<p style="color:#6B7280;">Nenhum mercado calculado teve vantagem real o suficiente para destaque nesta partida.</p>`;
  }

  return destaques
    .map((d) => {
      const prob = d.probabilidade_estimada != null ? ` (${Math.round(d.probabilidade_estimada * 100)}%)` : '';
      return `
      <div style="padding:14px 18px;margin:10px 0;border-radius:8px;background:#FFF8E1;border-left:4px solid #B8860B;">
        <div style="font-size:15px;color:#B8860B;font-weight:700;">
          ⭐ ${d.mercado} — ${d.selecao} @ ${d.odd}${prob}
        </div>
        <div style="font-size:13px;color:#6B7280;margin-top:4px;">EV: ${(d.ev * 100).toFixed(1)}%</div>
      </div>`;
    })
    .join('\n');
}

const RODAPE_FIXO = `
  <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0 16px 0;">
  <div style="font-size:13px;color:#9CA3AF;">
    Análise gerada pelo Moneyball SmartCenter. Odds e probabilidades calculadas a partir de dados coletados
    no momento da publicação -- confirme os valores atuais antes de apostar.
  </div>`;

/**
 * @param {Object} confronto - { match, league, data_hora }
 * @param {Object[]} mercadosVisiveis
 * @param {Object[]} destaques
 * @param {string} analiseHtml - texto (HTML simples) já escrito pelo Groq
 * @returns {{ titulo: string, html: string }}
 */
function montarArtigoPartida(confronto, mercadosVisiveis, destaques, analiseHtml) {
  const titulo = `Palpite ${confronto.match} — Odds e Análise (${confronto.league})`;

  const html = `
    <p style="color:#6B7280;font-size:14px;">${confronto.league} — ${confronto.data_hora || ''}</p>
    ${formatarTabelaOdds(mercadosVisiveis)}
    ${analiseHtml}
    <h3 style="margin:24px 0 8px 0;font-size:16px;">Destaques calculados</h3>
    ${formatarDestaques(destaques)}
    ${RODAPE_FIXO}`;

  return { titulo, html };
}

module.exports = { montarArtigoPartida };
