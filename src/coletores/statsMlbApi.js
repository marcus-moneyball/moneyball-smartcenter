'use strict';

/**
 * Corridas marcadas/sofridas por jogo via statsapi.mlb.com -- API OFICIAL
 * da MLB, gratuita, sem autenticação, sem histórico de bloqueio de bot
 * (ao contrário de stats.nba.com e basketball-reference.com). Substitui o
 * fallback fraco anterior (ERA/K9 via Gemini, que não mapeava bem pro
 * modelo do Pro).
 */

let cacheEquipes = null;

function normalizarNome(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function buscarEquipes() {
  if (cacheEquipes) return cacheEquipes;

  const resposta = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1');
  if (!resposta.ok) throw new Error(`statsapi.mlb.com respondeu ${resposta.status} ao listar times`);
  const dados = await resposta.json();

  cacheEquipes = dados.teams || [];
  return cacheEquipes;
}

function resolverIdTime(nomeTime, equipes) {
  const alvo = normalizarNome(nomeTime);
  const encontrado = equipes.find((t) => {
    const candidatos = [t.name, t.teamName, t.shortName, t.clubName].map(normalizarNome);
    return candidatos.some((c) => c && (c === alvo || alvo.includes(c) || c.includes(alvo)));
  });
  return encontrado?.id || null;
}

async function buscarCorridasPorJogo(teamId) {
  const temporada = new Date().getFullYear();

  const [respostaHitting, respostaPitching] = await Promise.all([
    fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=${temporada}`),
    fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=pitching&season=${temporada}`),
  ]);

  if (!respostaHitting.ok || !respostaPitching.ok) {
    throw new Error(`statsapi.mlb.com respondeu com erro ao buscar stats do time ${teamId}`);
  }

  const [dadosHitting, dadosPitching] = await Promise.all([respostaHitting.json(), respostaPitching.json()]);

  const statsHitting = dadosHitting.stats?.[0]?.splits?.[0]?.stat;
  const statsPitching = dadosPitching.stats?.[0]?.splits?.[0]?.stat;

  if (!statsHitting?.runs || !statsPitching?.runs || !statsHitting?.gamesPlayed) return null;

  // Mesmo cuidado do futebol/basquete: poucos jogos disputados deixam a
  // média vulnerável a um resultado fora da curva.
  const MINIMO_JOGOS_CONFIAVEL = 5;
  if (statsHitting.gamesPlayed < MINIMO_JOGOS_CONFIAVEL) return null;

  return {
    marcadas: Number((statsHitting.runs / statsHitting.gamesPlayed).toFixed(2)),
    sofridas: Number((statsPitching.runs / statsHitting.gamesPlayed).toFixed(2)),
  };
}

/**
 * @param {string} timeA
 * @param {string} timeB
 * @returns {Promise<Object|null>} { beisebol: { home_xg_ataque, home_xga_defesa, away_xg_ataque, away_xga_defesa } } ou null
 *   (nomes de campo reaproveitados por compatibilidade -- aqui são corridas reais por jogo)
 */
async function buscarStatsBeisebol(timeA, timeB) {
  const equipes = await buscarEquipes();
  const idA = resolverIdTime(timeA, equipes);
  const idB = resolverIdTime(timeB, equipes);

  if (!idA || !idB) {
    console.warn(`[MLB STATS API] Não encontrei "${timeA}" e/ou "${timeB}".`);
    return null;
  }

  const [mediaA, mediaB] = await Promise.all([buscarCorridasPorJogo(idA), buscarCorridasPorJogo(idB)]);
  if (!mediaA || !mediaB) return null;

  return {
    beisebol: {
      home_xg_ataque: mediaA.marcadas,
      home_xga_defesa: mediaA.sofridas,
      away_xg_ataque: mediaB.marcadas,
      away_xga_defesa: mediaB.sofridas,
    },
  };
}

module.exports = { buscarStatsBeisebol };
