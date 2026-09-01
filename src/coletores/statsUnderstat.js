'use strict';

/**
 * Scraper de xG direto do understat.com -- SEM Gemini, sem custo de
 * grounding. O Understat embute os dados da temporada numa variável JS
 * (`teamsData`) dentro de uma tag <script> da própria página, como um JSON
 * escapado -- não precisa de navegador/JS pra renderizar, só HTTP simples.
 *
 * Cobertura: só Premier League por enquanto (mesma liga que oddsApi.js e
 * resolverTimes.js já cobrem) -- outras ligas do Understat (La Liga,
 * Bundesliga, Serie A, Ligue 1, RFPL) podem ser adicionadas depois seguindo
 * o mesmo padrão, bastando mapear o sport_key da Odds API pro slug de liga
 * do Understat (ver LIGA_POR_SPORT_KEY abaixo).
 */

const LIGA_POR_SPORT_KEY = {
  soccer_epl: 'EPL',
};

// Ano de início da temporada (ex: temporada 2025/26 = "2025" no Understat).
// TODO: calcular dinamicamente pela data em vez de fixo, quando a temporada virar.
const TEMPORADA = '2025';

let cacheTeamsData = null; // Map<liga, objeto teamsData>

function normalizarNome(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

// Understat escapa a string JSON com sequências \xHH (hex) em vez de UTF-8
// direto -- precisa desescapar antes do JSON.parse.
function desescaparHex(str) {
  return str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function buscarTeamsData(liga) {
  if (cacheTeamsData?.[liga]) return cacheTeamsData[liga];

  const resposta = await fetch(`https://understat.com/league/${liga}/${TEMPORADA}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoneyballSmartCenter/1.0)' },
  });
  if (!resposta.ok) throw new Error(`understat.com respondeu ${resposta.status} para liga ${liga}`);
  const html = await resposta.text();

  const match = html.match(/var\s+teamsData\s*=\s*JSON\.parse\('(.+?)'\);/);
  if (!match) {
    throw new Error('Não encontrei a variável teamsData na página -- estrutura pode ter mudado.');
  }

  const jsonTexto = desescaparHex(match[1]);
  const teamsData = JSON.parse(jsonTexto);

  cacheTeamsData = cacheTeamsData || {};
  cacheTeamsData[liga] = teamsData;
  return teamsData;
}

function calcularMediasXG(timeData) {
  const historico = timeData?.history || [];
  if (historico.length === 0) return null;

  const somaXG = historico.reduce((soma, jogo) => soma + parseFloat(jogo.xG || 0), 0);
  const somaXGA = historico.reduce((soma, jogo) => soma + parseFloat(jogo.xGA || 0), 0);

  return {
    xg_ataque: Number((somaXG / historico.length).toFixed(2)),
    xga_defesa: Number((somaXGA / historico.length).toFixed(2)),
  };
}

/**
 * @param {string} timeA
 * @param {string} timeB
 * @param {string} sportKey - ex: 'soccer_epl'
 * @returns {Promise<Object|null>} { futebol: { home_xg_ataque, ... } } ou null
 */
async function buscarStatsFutebol(timeA, timeB, sportKey) {
  const liga = LIGA_POR_SPORT_KEY[sportKey];
  if (!liga) return null; // liga fora de cobertura do Understat por enquanto

  const teamsData = await buscarTeamsData(liga);
  const times = Object.values(teamsData);

  const encontrarTime = (nome) => {
    const alvo = normalizarNome(nome);
    return times.find((t) => {
      const nomeNorm = normalizarNome(t.title);
      return nomeNorm === alvo || alvo.includes(nomeNorm) || nomeNorm.includes(alvo);
    });
  };

  const timeAEncontrado = encontrarTime(timeA);
  const timeBEncontrado = encontrarTime(timeB);

  if (!timeAEncontrado || !timeBEncontrado) {
    console.warn(`[UNDERSTAT] Não encontrei "${timeA}" e/ou "${timeB}" nos dados da liga ${liga}.`);
    return null;
  }

  const mediasA = calcularMediasXG(timeAEncontrado);
  const mediasB = calcularMediasXG(timeBEncontrado);
  if (!mediasA || !mediasB) return null;

  return {
    futebol: {
      home_xg_ataque: mediasA.xg_ataque,
      home_xga_defesa: mediasA.xga_defesa,
      away_xg_ataque: mediasB.xg_ataque,
      away_xga_defesa: mediasB.xga_defesa,
    },
  };
}

module.exports = { buscarStatsFutebol };
