'use strict';

/**
 * Gols marcados/sofridos por jogo via football-data.org -- API de verdade
 * (não scraping), já configurada (FOOTBALL_DATA_API_KEY). Esse é o mesmo
 * dado que estimar_lambda() do Pro usa pro futebol -- não é proxy de xG,
 * é literalmente a métrica que o modelo espera (mesma filosofia dos
 * outros esportes: reaproveitar o que o Pro já usa, não inventar métrica nova).
 */

const SPORT_KEY_PARA_COMPETICAO = {
  soccer_epl: 'PL',
  // TODO: adicionar outras ligas aqui conforme oddsApi.js crescer
};

let cacheEquipesPorCompeticao = {};
let cacheStandingsPorCompeticao = {};

function normalizarNome(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function buscarEquipes(competicao) {
  if (cacheEquipesPorCompeticao[competicao]) return cacheEquipesPorCompeticao[competicao];

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY não configurada.');

  const resposta = await fetch(`https://api.football-data.org/v4/competitions/${competicao}/teams`, {
    headers: { 'X-Auth-Token': apiKey },
  });
  if (!resposta.ok) throw new Error(`football-data.org respondeu ${resposta.status} ao listar times de ${competicao}`);
  const dados = await resposta.json();

  cacheEquipesPorCompeticao[competicao] = dados.teams || [];
  return cacheEquipesPorCompeticao[competicao];
}

async function buscarStandings(competicao) {
  if (cacheStandingsPorCompeticao[competicao]) return cacheStandingsPorCompeticao[competicao];

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  const resposta = await fetch(`https://api.football-data.org/v4/competitions/${competicao}/standings`, {
    headers: { 'X-Auth-Token': apiKey },
  });
  if (!resposta.ok) throw new Error(`football-data.org respondeu ${resposta.status} ao buscar standings de ${competicao}`);
  const dados = await resposta.json();

  const tabela = dados.standings?.find((s) => s.type === 'TOTAL')?.table || [];
  cacheStandingsPorCompeticao[competicao] = tabela;
  return tabela;
}

function resolverIdTime(nomeTime, equipes) {
  const alvo = normalizarNome(nomeTime);
  const encontrado = equipes.find((t) => {
    const candidatos = [t.name, t.shortName, t.tla].map(normalizarNome);
    return candidatos.some((c) => c && (c === alvo || alvo.includes(c) || c.includes(alvo)));
  });
  return encontrado?.id || null;
}

/**
 * @param {string} timeA
 * @param {string} timeB
 * @param {string} sportKey - ex: 'soccer_epl'
 * @returns {Promise<Object|null>} { futebol: { home_xg_ataque, home_xga_defesa, away_xg_ataque, away_xga_defesa } } ou null
 *   (nomes de campo reaproveitados por compatibilidade -- aqui são gols reais por jogo, não xG)
 */
async function buscarStatsFutebol(timeA, timeB, sportKey) {
  const competicao = SPORT_KEY_PARA_COMPETICAO[sportKey];
  if (!competicao) return null;

  const equipes = await buscarEquipes(competicao);
  const idA = resolverIdTime(timeA, equipes);
  const idB = resolverIdTime(timeB, equipes);

  if (!idA || !idB) {
    console.warn(`[FOOTBALL-DATA] Não encontrei "${timeA}" e/ou "${timeB}" na competição ${competicao}.`);
    return null;
  }

  const tabela = await buscarStandings(competicao);
  const linhaA = tabela.find((l) => l.team.id === idA);
  const linhaB = tabela.find((l) => l.team.id === idB);

  // Amostra pequena (início de temporada) deixa a média vulnerável a um
  // único jogo de placar fora da curva (ex: 5-2 na 1ª rodada distorce a
  // média de gols de um time que só jogou 2-3 partidas). Abaixo desse
  // mínimo, prefere cair pro Gemini (que pelo menos busca contexto
  // qualitativo) a confiar numa média estatisticamente frágil.
  const MINIMO_JOGOS_CONFIAVEL = 5;
  if (
    !linhaA?.playedGames ||
    !linhaB?.playedGames ||
    linhaA.playedGames < MINIMO_JOGOS_CONFIAVEL ||
    linhaB.playedGames < MINIMO_JOGOS_CONFIAVEL
  ) {
    return null;
  }

  return {
    futebol: {
      home_xg_ataque: Number((linhaA.goalsFor / linhaA.playedGames).toFixed(2)),
      home_xga_defesa: Number((linhaA.goalsAgainst / linhaA.playedGames).toFixed(2)),
      away_xg_ataque: Number((linhaB.goalsFor / linhaB.playedGames).toFixed(2)),
      away_xga_defesa: Number((linhaB.goalsAgainst / linhaB.playedGames).toFixed(2)),
    },
  };
}

module.exports = { buscarStatsFutebol };
