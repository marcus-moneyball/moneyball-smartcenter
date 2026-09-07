'use strict';

const { buscarStatsFutebol } = require('./coletores/statsFootballData');
const { buscarStatsBasquete } = require('./coletores/statsBallDontLie');
const { buscarStatsBeisebol, buscarStatsArremessador } = require('./coletores/statsMlbApi');

/**
 * Reconhece o mercado pelo NOME que vem no JSON (mercados_visiveis) e
 * decide: (a) que provider de stats chamar, (b) como montar o objeto que
 * calcular_mercado() do Pro espera (linha, odd_real_decimal, lado_odd,
 * media_marcada/sofrida_time_a/b OU media_esperada, modelo, desvio_padrao).
 *
 * Mercados de TIME (duas médias que convergem) usam Poisson (contagem:
 * gols, corridas, escanteios) ou Normal (pontuação maior: pontos de
 * basquete). Mercados de JOGADOR (uma métrica só) usam media_esperada
 * direto, Poisson (contagem discreta pequena).
 */

const SPORT_KEY_PARA_ESPORTE = {
  soccer_epl: 'futebol',
  soccer_brazil_campeonato: 'futebol',
  basketball_nba: 'basquete',
  basketball_wnba: 'basquete',
  baseball_mlb: 'beisebol',
};

function extrairLinhaOdd(selecao, odd) {
  // "Over 2.5" -> { lado: 'over', linha: 2.5 } | "Manchester United -1.5" -> linha do handicap
  const match = selecao.match(/(-?\d+(\.\d+)?)/);
  const linha = match ? Number(match[1].replace('-', '')) : null;
  const lado = /under|menos/i.test(selecao) ? 'under' : 'over';
  return { linha, lado };
}

/**
 * @param {Object} item - { mercado, selecao, odd, jogador? } (um item de mercados_visiveis)
 * @param {Object} confronto - { match, league, sport_key, time_a, time_b }
 * @returns {Promise<Object|null>} objeto de mercado pronto pro /api/v1/calc, ou null se não reconhecido/sem dado
 */
async function montarMercado(item, confronto) {
  const esporte = SPORT_KEY_PARA_ESPORTE[confronto.sport_key];
  if (!esporte) {
    console.warn(`[MONTAR MERCADO] sport_key "${confronto.sport_key}" não mapeado -- pulando "${item.mercado}".`);
    return null;
  }

  const nomeMercado = item.mercado.toLowerCase();
  const idBase = `${confronto.match}-${item.mercado}-${item.selecao}`.replace(/\s+/g, '_');

  // --- Mercados de time: Total (gols/pontos/corridas) e Handicap -----------
  if (/total|over|under/.test(nomeMercado)) {
    const { linha, lado } = extrairLinhaOdd(item.selecao, item.odd);
    if (linha == null) return null;

    let stats = null;
    if (esporte === 'futebol') stats = await buscarStatsFutebol(confronto.time_a, confronto.time_b, confronto.sport_key);
    else if (esporte === 'basquete') stats = await buscarStatsBasquete(confronto.time_a, confronto.time_b);
    else if (esporte === 'beisebol') stats = await buscarStatsBeisebol(confronto.time_a, confronto.time_b);

    const s = stats?.[esporte];
    if (!s) return null;

    return {
      id: idBase,
      tipo: 'total_jogo',
      modelo: esporte === 'basquete' ? 'normal' : 'poisson',
      linha,
      odd_real_decimal: item.odd,
      lado_odd: lado,
      media_marcada_time_a: s.home_xg_ataque,
      media_sofrida_time_a: s.home_xga_defesa,
      media_marcada_time_b: s.away_xg_ataque,
      media_sofrida_time_b: s.away_xga_defesa,
      desvio_padrao: esporte === 'basquete' ? 12 : undefined,
    };
  }

  // --- Moneyline: pendência conhecida -- calcular_mercado() do Pro é
  // estruturado em torno de linha + over/under, não achei fórmula própria
  // pra vitória/derrota simples ainda. Não vou inventar sem confirmar.
  if (/moneyline/.test(nomeMercado)) {
    console.warn('[MONTAR MERCADO] Moneyline ainda sem fórmula confirmada no Pro -- pulando.');
    return null;
  }

  // --- Handicap (spread) de time ---------------------------------------------
  if (/handicap/.test(nomeMercado)) {
    // TODO: handicap ainda não tem fórmula própria no Pro além do total_jogo
    // genérico -- por ora tratado como pendência, não calcula.
    console.warn(`[MONTAR MERCADO] Handicap ainda não implementado -- pulando "${item.mercado}".`);
    return null;
  }

  // --- Prop de jogador (ex: Strikeouts) ---------------------------------------
  if (item.jogador) {
    const { linha, lado } = extrairLinhaOdd(item.selecao, item.odd);
    if (linha == null) return null;

    if (esporte !== 'beisebol') {
      console.warn(`[MONTAR MERCADO] Prop de jogador só implementada pra beisebol ainda -- pulando "${item.mercado}".`);
      return null;
    }

    const stats = await buscarStatsArremessador(item.jogador);
    if (!stats) return null;

    return {
      id: idBase,
      tipo: 'prop_jogador',
      modelo: 'poisson',
      linha,
      odd_real_decimal: item.odd,
      lado_odd: lado,
      media_esperada: stats.strikeouts_por_jogo,
    };
  }

  // --- Escanteios: pendência conhecida, sem fonte confirmada ainda ----------
  if (/escanteio/.test(nomeMercado)) {
    console.warn('[MONTAR MERCADO] Escanteios sem fonte de dado confirmada ainda -- pulando.');
    return null;
  }

  console.warn(`[MONTAR MERCADO] Mercado "${item.mercado}" não reconhecido -- pulando.`);
  return null;
}

module.exports = { montarMercado };
