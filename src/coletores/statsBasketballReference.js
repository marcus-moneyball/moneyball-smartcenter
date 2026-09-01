'use strict';

/**
 * Scraper de estatísticas de basquete direto do basketball-reference.com --
 * SEM Gemini, sem custo de grounding. A página "Team Ratings" lista ORtg/
 * DRtg/NRtg reais (não proxy) de todos os 30 times numa tabela HTML simples
 * (confirmado: não está escondida em comentário HTML, ao contrário de
 * algumas tabelas "avançadas" desse site).
 *
 * PENDÊNCIA CONHECIDA: "pace" (posses por jogo) não está nessa página --
 * fica em outra tabela (team advanced/per-poss) que ainda não confirmei a
 * estrutura. filtroQualidade.js não vai considerar basquete 100% completo
 * até isso ser resolvido, mas net_rating real já é uma melhoria grande
 * sobre a proxy anterior.
 */

const URL_RATINGS = 'https://www.basketball-reference.com/leagues/NBA_2026_ratings.html';

let cacheRatings = null; // Array<{ nome, ortg, drtg, nrtg }>

function normalizarNome(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function buscarRatingsBasketballReference() {
  if (cacheRatings) return cacheRatings;

  const resposta = await fetch(URL_RATINGS, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoneyballSmartCenter/1.0)' },
  });
  if (!resposta.ok) throw new Error(`basketball-reference.com respondeu ${resposta.status}`);
  const html = await resposta.text();

  // Parse simples via regex nas linhas da tabela -- evita depender de uma
  // lib de parsing de HTML só para uma tabela bem regular. Cada linha de
  // time tem: <td ...>Team</td>...<td ...>ORtg</td><td ...>DRtg</td><td ...>NRtg</td>
  // (colunas "Unadjusted"). Ajuste se a estrutura da página mudar.
  const linhas = [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const times = [];

  for (const linha of linhas) {
    const nomeMatch = linha.match(/teams\/[A-Z]{3}\/\d{4}\.html"[^>]*>([^<]+)</);
    if (!nomeMatch) continue;

    const celulas = [...linha.matchAll(/<td[^>]*data-stat="([a-z_]+)"[^>]*>([^<]*)</g)];
    const porCampo = Object.fromEntries(celulas.map((c) => [c[1], c[2]]));

    const ortg = parseFloat(porCampo.off_rtg);
    const drtg = parseFloat(porCampo.def_rtg);
    const nrtg = parseFloat(porCampo.net_rtg);

    if (!Number.isNaN(ortg) && !Number.isNaN(drtg)) {
      times.push({ nome: nomeMatch[1], ortg, drtg, nrtg: Number.isNaN(nrtg) ? ortg - drtg : nrtg });
    }
  }

  if (times.length === 0) {
    throw new Error('Não consegui extrair nenhuma linha de time -- a estrutura da página pode ter mudado.');
  }

  cacheRatings = times;
  return times;
}

/**
 * @param {string} timeA
 * @param {string} timeB
 * @returns {Promise<Object|null>} { basquete: { net_rating_casa, net_rating_visitante } } ou null
 */
async function buscarStatsBasquete(timeA, timeB) {
  const times = await buscarRatingsBasketballReference();
  const alvoA = normalizarNome(timeA);
  const alvoB = normalizarNome(timeB);

  const encontrarTime = (alvo) =>
    times.find((t) => {
      const nomeNorm = normalizarNome(t.nome);
      return nomeNorm === alvo || alvo.includes(nomeNorm) || nomeNorm.includes(alvo);
    });

  const timeAEncontrado = encontrarTime(alvoA);
  const timeBEncontrado = encontrarTime(alvoB);

  if (!timeAEncontrado || !timeBEncontrado) {
    console.warn(`[BASKETBALL-REFERENCE] Não encontrei "${timeA}" e/ou "${timeB}" na tabela de ratings.`);
    return null;
  }

  return {
    basquete: {
      net_rating_casa: timeAEncontrado.nrtg,
      net_rating_visitante: timeBEncontrado.nrtg,
      // pace_casa: TODO -- não está nesta página, ver docstring do arquivo.
    },
  };
}

module.exports = { buscarStatsBasquete };
