'use strict';

/**
 * Filtro de qualidade: decide se um jogo tem dados suficientes pra entrar no
 * relatório da rodada. NUNCA interpreta resultado/probabilidade — só mede
 * completude estrutural do payload (mesmo espírito do "Data Confidence" do
 * Scanner: qualidade dos dados coletados, não qualidade da oportunidade).
 *
 * Isso roda ANTES de chamar a Gemini, pra não gastar chamada de IA em jogo
 * que não tem dado suficiente pra sustentar um prognóstico responsável.
 */

// Campos mínimos exigidos por esporte para considerar o jogo "analisável".
// Ajustável sem tocar na lógica de cálculo.
const REQUISITOS_POR_ESPORTE = {
  futebol: {
    odds: ['linhas_gols.over_2_5', 'ambas_marcam.sim', 'chance_dupla.1X'],
    stats: [
      'futebol.home_xg_ataque',
      'futebol.home_xga_defesa',
      'futebol.away_xg_ataque',
      'futebol.away_xga_defesa',
    ],
  },
  beisebol: {
    odds: ['linha_corridas.over', 'moneyline.casa', 'moneyline.visitante'],
    stats: ['beisebol.era_titular_casa', 'beisebol.era_titular_visitante', 'beisebol.k9_titular_casa'],
  },
  basquete: {
    odds: ['handicap.linha', 'total_pontos.over', 'moneyline.casa'],
    stats: ['basquete.net_rating_casa', 'basquete.net_rating_visitante', 'basquete.pace_casa'],
  },
};

const PESO_ODDS = 0.4;
const PESO_STATS = 0.4;
const PESO_TRAVAS = 0.2;

const LIMIAR_APROVACAO_PADRAO = 0.7;

/** Lê um caminho tipo "futebol.home_xg_ataque" de um objeto aninhado. */
function lerCaminho(obj, caminho) {
  return caminho
    .split('.')
    .reduce((atual, chave) => (atual && typeof atual === 'object' ? atual[chave] : undefined), obj);
}

function valorPresente(valor) {
  return valor !== undefined && valor !== null && valor !== '';
}

function calcularCobertura(payload, blocoBase, campos) {
  if (campos.length === 0) return 1;
  const presentes = campos.filter((campo) => valorPresente(lerCaminho(payload[blocoBase], campo)));
  return presentes.length / campos.length;
}

/**
 * calcularQualidade(payload)
 * @returns {{ score: number, aprovado: boolean, detalhes: Object, motivos: string[] }}
 */
function calcularQualidade(payload, opcoes = {}) {
  const limiar = opcoes.limiar ?? Number(process.env.QUALIDADE_LIMIAR) ?? LIMIAR_APROVACAO_PADRAO;
  const esporte = String(payload?.evento?.esporte || '').toLowerCase();
  const requisitos = REQUISITOS_POR_ESPORTE[esporte];

  const motivos = [];

  if (!requisitos) {
    return {
      score: 0,
      aprovado: false,
      detalhes: {},
      motivos: [`Esporte "${payload?.evento?.esporte}" sem requisitos de qualidade definidos.`],
    };
  }

  const coberturaOdds = calcularCobertura(payload, 'cotacoes_odds_api', requisitos.odds);
  const coberturaStats = calcularCobertura(payload, 'metricas_sports_api', requisitos.stats);

  const travasPresentes = valorPresente(payload?.pre_calculos_radar?.travas_automaticas);
  const scoreTravas = travasPresentes ? 1 : 0;

  const score =
    coberturaOdds * PESO_ODDS + coberturaStats * PESO_STATS + scoreTravas * PESO_TRAVAS;

  if (coberturaOdds < 1) motivos.push(`Cobertura de odds incompleta (${Math.round(coberturaOdds * 100)}%).`);
  if (coberturaStats < 1) motivos.push(`Cobertura de estatísticas incompleta (${Math.round(coberturaStats * 100)}%).`);
  if (!travasPresentes) motivos.push('"travas_automaticas" ausente no pre_calculos_radar.');

  return {
    score: Number(score.toFixed(3)),
    aprovado: score >= limiar,
    detalhes: { coberturaOdds, coberturaStats, travasPresentes, limiar },
    motivos,
  };
}

module.exports = { calcularQualidade, REQUISITOS_POR_ESPORTE };
