'use strict';

/**
 * Scraper de basquete direto do basketball-reference.com -- SEM Gemini, sem
 * custo de grounding. Uma única página (season summary) traz tudo que
 * precisamos:
 *   - "Per Game Stats" (Team / Opponent): pontos marcados e sofridos por
 *     jogo -- o equivalente de basquete ao xG do futebol, e o que
 *     estimar_lambda() do Pro realmente precisa (media_marcada/sofrida).
 *   - "Advanced Stats": ORtg, DRtg, NRtg e Pace real -- resolve a pendência
 *     anterior (antes eu não tinha achado pace nessa fonte).
 *
 * IMPORTANTE: os ids de tabela abaixo ("per_game-team", "per_game-opponent",
 * "advanced-team") seguem a convenção conhecida do basketball-reference,
 * mas não foram confirmados campo-a-campo contra o HTML bruto real (o
 * conteúdo que inspecionei veio convertido em texto). Se a Basketball-
 * Reference mudar a estrutura, isso falha de forma visível (fail-open,
 * loga aviso) -- ver console.warn abaixo.
 */

const URL_POR_LIGA = {
  nba: 'https://www.basketball-reference.com/leagues/NBA_2026.html',
  wnba: 'https://www.basketball-reference.com/wnba/years/2026.html',
};

const SPORT_KEY_PARA_LIGA = {
  basketball_nba: 'nba',
  basketball_wnba: 'wnba',
};

let cachePorLiga = {}; // { [liga]: { pontosPorTime, avancadoPorTime } }

function normalizarNome(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function extrairTabelaPorId(html, id) {
  const inicio = html.indexOf(`id="${id}"`);
  if (inicio === -1) return null;
  const tabelaInicio = html.lastIndexOf('<table', inicio);
  const tabelaFim = html.indexOf('</table>', inicio);
  if (tabelaInicio === -1 || tabelaFim === -1) return null;
  return html.slice(tabelaInicio, tabelaFim + '</table>'.length);
}

function extrairLinhasComTime(tabelaHtml) {
  if (!tabelaHtml) return [];
  const linhas = [...tabelaHtml.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const resultado = [];

  for (const linha of linhas) {
    const abbrMatch = linha.match(/teams\/([A-Z]{3})\/\d{4}\.html"[^>]*>([^<]+)</);
    if (!abbrMatch) continue;

    const celulas = [...linha.matchAll(/<td[^>]*data-stat="([a-z0-9_]+)"[^>]*>([^<]*)</g)];
    const porCampo = Object.fromEntries(celulas.map((c) => [c[1], c[2]]));

    resultado.push({ abbr: abbrMatch[1], nome: abbrMatch[2], campos: porCampo });
  }

  return resultado;
}

async function buscarDadosTemporada(liga) {
  if (cachePorLiga[liga]) return cachePorLiga[liga];

  const url = URL_POR_LIGA[liga];
  if (!url) throw new Error(`Liga "${liga}" sem URL mapeada.`);

  const resposta = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoneyballSmartCenter/1.0)' },
  });
  if (!resposta.ok) throw new Error(`basketball-reference.com respondeu ${resposta.status} (${liga})`);
  const html = await resposta.text();

  const tabelaTime = extrairTabelaPorId(html, 'per_game-team');
  const tabelaAdversario = extrairTabelaPorId(html, 'per_game-opponent');
  const tabelaAvancada = extrairTabelaPorId(html, 'advanced-team');

  const linhasTime = extrairLinhasComTime(tabelaTime);
  const linhasAdversario = extrairLinhasComTime(tabelaAdversario);
  const linhasAvancada = extrairLinhasComTime(tabelaAvancada);

  if (linhasTime.length === 0 || linhasAdversario.length === 0) {
    throw new Error('Não consegui extrair as tabelas Per Game Stats (Team/Opponent) -- estrutura pode ter mudado.');
  }

  const pontosPorTime = new Map();
  for (const linha of linhasTime) {
    pontosPorTime.set(linha.abbr, { marcados: parseFloat(linha.campos.pts), nome: linha.nome });
  }
  for (const linha of linhasAdversario) {
    const atual = pontosPorTime.get(linha.abbr) || {};
    pontosPorTime.set(linha.abbr, { ...atual, sofridos: parseFloat(linha.campos.pts) });
  }

  const avancadoPorTime = new Map();
  for (const linha of linhasAvancada) {
    avancadoPorTime.set(linha.abbr, {
      ortg: parseFloat(linha.campos.off_rtg),
      drtg: parseFloat(linha.campos.def_rtg),
      nrtg: parseFloat(linha.campos.net_rtg),
      pace: parseFloat(linha.campos.pace),
    });
  }

  cachePorLiga[liga] = { pontosPorTime, avancadoPorTime };
  return cachePorLiga[liga];
}

function encontrarAbbrPorNome(nomeAlvo, pontosPorTime) {
  const alvo = normalizarNome(nomeAlvo);
  for (const [abbr, dados] of pontosPorTime.entries()) {
    const nomeNorm = normalizarNome(dados.nome);
    if (nomeNorm === alvo || alvo.includes(nomeNorm) || nomeNorm.includes(alvo)) return abbr;
  }
  return null;
}

/**
 * @param {string} timeA
 * @param {string} timeB
 * @returns {Promise<Object|null>} { basquete: { home_xg_ataque, home_xga_defesa, away_xg_ataque, away_xga_defesa, net_rating_casa, net_rating_visitante, pace_casa } } ou null
 *
 * Os nomes de campo home_xg_ataque/home_xga_defesa são reaproveitados do
 * contrato do futebol (mesma forma que estimar_lambda() do Pro espera) --
 * aqui carregam pontos marcados/sofridos por jogo, não xG de verdade.
 */
async function buscarStatsBasquete(timeA, timeB, sportKey) {
  const liga = SPORT_KEY_PARA_LIGA[sportKey] || 'nba';
  const { pontosPorTime, avancadoPorTime } = await buscarDadosTemporada(liga);

  const abbrA = encontrarAbbrPorNome(timeA, pontosPorTime);
  const abbrB = encontrarAbbrPorNome(timeB, pontosPorTime);

  if (!abbrA || !abbrB) {
    console.warn(`[BASKETBALL-REFERENCE] Não encontrei "${timeA}" e/ou "${timeB}" na tabela de pontos.`);
    return null;
  }

  const pontosA = pontosPorTime.get(abbrA);
  const pontosB = pontosPorTime.get(abbrB);
  if (pontosA?.marcados == null || pontosA?.sofridos == null || pontosB?.marcados == null || pontosB?.sofridos == null) {
    return null;
  }

  const avancadoA = avancadoPorTime.get(abbrA) || {};
  const avancadoB = avancadoPorTime.get(abbrB) || {};

  return {
    basquete: {
      home_xg_ataque: pontosA.marcados,
      home_xga_defesa: pontosA.sofridos,
      away_xg_ataque: pontosB.marcados,
      away_xga_defesa: pontosB.sofridos,
      net_rating_casa: avancadoA.nrtg ?? null,
      net_rating_visitante: avancadoB.nrtg ?? null,
      pace_casa: avancadoA.pace ?? null,
    },
  };
}

module.exports = { buscarStatsBasquete };
