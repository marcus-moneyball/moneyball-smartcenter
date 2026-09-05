'use strict';

/**
 * Pontos marcados/sofridos por jogo via balldontlie.io -- API de verdade
 * (não scraping), já configurada (BALLDONTLIE_API_KEY). Cobre só NBA (não
 * tem WNBA) -- pra WNBA, sportsApi.js cai pro Gemini.
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

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error('BALLDONTLIE_API_KEY não configurada.');

  const resposta = await fetch('https://api.balldontlie.io/v1/teams', {
    headers: { Authorization: apiKey },
  });
  if (!resposta.ok) throw new Error(`balldontlie.io respondeu ${resposta.status} ao listar times`);
  const dados = await resposta.json();

  cacheEquipes = dados.data || [];
  return cacheEquipes;
}

function resolverIdTime(nomeTime, equipes) {
  const alvo = normalizarNome(nomeTime);
  const encontrado = equipes.find((t) => {
    const candidatos = [t.full_name, t.name, t.city, t.abbreviation].map(normalizarNome);
    return candidatos.some((c) => c && (c === alvo || alvo.includes(c) || c.includes(alvo)));
  });
  return encontrado?.id || null;
}

async function buscarUltimosJogos(teamId, quantidade = 10) {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  const resposta = await fetch(
    `https://api.balldontlie.io/v1/games?team_ids[]=${teamId}&per_page=${quantidade}`,
    { headers: { Authorization: apiKey } }
  );
  if (!resposta.ok) throw new Error(`balldontlie.io respondeu ${resposta.status} ao buscar jogos do time ${teamId}`);
  const dados = await resposta.json();
  return dados.data || [];
}

function mediaMarcadosSofridos(jogos, teamId) {
  const finalizados = jogos.filter(
    (j) => (j.home_team.id === teamId || j.visitor_team.id === teamId) && j.status === 'Final'
  );
  if (finalizados.length === 0) return null;

  let somaMarcados = 0;
  let somaSofridos = 0;
  for (const jogo of finalizados) {
    if (jogo.home_team.id === teamId) {
      somaMarcados += jogo.home_team_score;
      somaSofridos += jogo.visitor_team_score;
    } else {
      somaMarcados += jogo.visitor_team_score;
      somaSofridos += jogo.home_team_score;
    }
  }

  return {
    marcados: Number((somaMarcados / finalizados.length).toFixed(2)),
    sofridos: Number((somaSofridos / finalizados.length).toFixed(2)),
  };
}

/**
 * @param {string} timeA
 * @param {string} timeB
 * @returns {Promise<Object|null>} { basquete: { home_xg_ataque, home_xga_defesa, away_xg_ataque, away_xga_defesa } } ou null
 *   (nomes de campo reaproveitados por compatibilidade -- aqui são pontos reais por jogo)
 */
async function buscarStatsBasquete(timeA, timeB) {
  const equipes = await buscarEquipes();
  const idA = resolverIdTime(timeA, equipes);
  const idB = resolverIdTime(timeB, equipes);

  if (!idA || !idB) {
    console.warn(`[BALLDONTLIE] Não encontrei "${timeA}" e/ou "${timeB}" (provavelmente WNBA, sem cobertura aqui).`);
    return null;
  }

  const [jogosA, jogosB] = await Promise.all([buscarUltimosJogos(idA), buscarUltimosJogos(idB)]);
  const mediaA = mediaMarcadosSofridos(jogosA, idA);
  const mediaB = mediaMarcadosSofridos(jogosB, idB);

  if (!mediaA || !mediaB) return null;

  return {
    basquete: {
      home_xg_ataque: mediaA.marcados,
      home_xga_defesa: mediaA.sofridos,
      away_xg_ataque: mediaB.marcados,
      away_xga_defesa: mediaB.sofridos,
    },
  };
}

module.exports = { buscarStatsBasquete };
