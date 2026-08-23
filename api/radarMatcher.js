'use strict';

const { query } = require('./db');

// require() de JSON é ESTÁTICO — o empacotador da Vercel sempre detecta e
// inclui esse arquivo na function. fs.readFileSync com caminho montado em
// runtime (o jeito antigo daqui) NÃO é detectável estaticamente, e a
// Vercel pode deixar o arquivo de fora do deploy — a function crasha com
// ENOENT assim que tenta ler, devolvendo uma página de erro HTML/texto em
// vez de JSON (é esse o erro "Unexpected token 'A', 'A server e...'").
const whitelist = require('../config/leagues-whitelist.json');

/**
 * radarMatcher — casa cada pick do JSON do Moneyball Radar (v2.1/v3.0, gerado
 * no chat/Gemini) com um fixture real já coletado pelo cron no banco.
 *
 * Responsabilidade única: dado um pick { esporte, match, league }, achar o
 * fixture correspondente (ou null). NUNCA cria fixture, NUNCA busca odds/stat
 * externa — isso já existe em coletaNoturna.js/coletaOddsApi.js. Se o cron
 * ainda não coletou (ou a liga não está na whitelist), o pick fica sem match
 * e quem decide o que fazer com isso é o endpoint que chama este módulo.
 */

function normalizarNomeTime(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cfc|esporte clube|clube de regatas|futebol clube)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** "Time A x Time B" ou "Time A vs Time B" → { casa, visitante } */
function separarConfronto(match) {
  const partes = String(match || '').split(/\s+(?:x|vs\.?)\s+/i);
  if (partes.length !== 2) return null;
  return { casa: partes[0].trim(), visitante: partes[1].trim() };
}

/**
 * ligaEstaNaWhitelist(esporte, nomeLiga)
 * Diferencia "liga fora da cobertura gratuita" (nunca vai casar, não adianta
 * esperar o cron) de "liga coberta, só não coletou ainda" (esperar o cron
 * resolve). Comparação por nome é aproximada de propósito — o Radar escreve
 * o nome da liga livremente, não pelo código interno (BSA, PL, etc).
 */
function ligaEstaNaWhitelist(esporte, nomeLiga) {
  const config = whitelist[esporte];
  if (!config) return false;

  const alvo = normalizarNomeTime(nomeLiga);
  if (!alvo) return true; // sem nome de liga informado — não descarta por isso, deixa o match por time decidir

  return (config.ligas || []).some((l) => normalizarNomeTime(l.nome) === alvo || alvo.includes(normalizarNomeTime(l.nome)));
}

/**
 * buscarFixtureParaPick({ esporte, match, league })
 *
 * Estratégia: busca fixtures do esporte numa janela de -1 a +4 dias (jogos
 * atrasados em atualizar status ainda contam; jogos futuros são o caso comum),
 * compara nomes normalizados dos dois times.
 *
 *   Passo 1 — match exato, mesma ordem (casa=casa, visitante=visitante).
 *   Passo 2 — match por inclusão, mesma ordem (nomes abreviados entre
 *             provedores — ex: "Manchester City" vs "Man City").
 *   Passo 3 — match exato OU por inclusão, ORDEM INVERTIDA (casa do pick
 *             bate com visitante do fixture e vice-versa). Existe porque o
 *             Radar lê a ordem que o print mostrou, e muitas casas de
 *             apostas/prints listam o visitante primeiro (ou "Away @ Home") —
 *             sem isso, um jogo já coletado no banco fica preso pra sempre
 *             no fallback "ainda não coletado pelo cron".
 *
 * @returns {Promise<Object|null>} fixture (mesmo shape de db.obterFixturePorId) ou null
 */
async function buscarFixtureParaPick({ esporte, match, league }) {
  const confronto = separarConfronto(match);
  if (!confronto) return { encontrado: false, motivo: `Não consegui separar "${match}" em casa x visitante.` };

  const casaAlvo = normalizarNomeTime(confronto.casa);
  const visitanteAlvo = normalizarNomeTime(confronto.visitante);

  const resultado = await query(
    `SELECT f.id, f.data_hora, f.status,
            l.nome AS liga_nome,
            tc.nome AS time_casa, tv.nome AS time_visitante
     FROM fixtures f
     JOIN leagues l ON l.id = f.liga_id
     JOIN teams tc ON tc.id = f.time_casa_id
     JOIN teams tv ON tv.id = f.time_visitante_id
     WHERE f.esporte = $1
       AND f.data_hora BETWEEN now() - interval '1 day' AND now() + interval '4 days'`,
    [esporte]
  );

  const candidatos = resultado.rows.map((linha) => ({
    ...linha,
    casaNorm: normalizarNomeTime(linha.time_casa),
    visitanteNorm: normalizarNomeTime(linha.time_visitante),
  }));

  // Passo 1: match exato dos dois lados, mesma ordem.
  let achado = candidatos.find((c) => c.casaNorm === casaAlvo && c.visitanteNorm === visitanteAlvo);
  let ordemInvertida = false;

  // Passo 2: match por inclusão, mesma ordem (nomes abreviados/diferentes entre provedores).
  if (!achado) {
    achado = candidatos.find(
      (c) =>
        (c.casaNorm.includes(casaAlvo) || casaAlvo.includes(c.casaNorm)) &&
        (c.visitanteNorm.includes(visitanteAlvo) || visitanteAlvo.includes(c.visitanteNorm))
    );
  }

  // Passo 3: mesma lógica dos passos 1+2, mas com casa/visitante trocados —
  // cobre picks onde o print listou "Visitante x Casa".
  if (!achado) {
    achado = candidatos.find(
      (c) =>
        (c.casaNorm === visitanteAlvo && c.visitanteNorm === casaAlvo) ||
        ((c.casaNorm.includes(visitanteAlvo) || visitanteAlvo.includes(c.casaNorm)) &&
          (c.visitanteNorm.includes(casaAlvo) || casaAlvo.includes(c.visitanteNorm)))
    );
    if (achado) ordemInvertida = true;
  }

  if (!achado) {
    const naWhitelist = ligaEstaNaWhitelist(esporte, league);
    return {
      encontrado: false,
      motivo: naWhitelist
        ? 'Ainda não coletado pelo cron — tente novamente após a próxima rodada de coleta (06h/madrugada).'
        : `Liga "${league}" fora da cobertura gratuita atual (${esporte}) — não vai casar mesmo esperando o cron.`,
    };
  }

  return {
    encontrado: true,
    fixtureId: achado.id,
    ligaNome: achado.liga_nome,
    timeCasa: achado.time_casa,
    timeVisitante: achado.time_visitante,
    dataHora: achado.data_hora,
    status: achado.status,
    ordemInvertidaNoPick: ordemInvertida, // true = o pick listou visitante x casa
  };
}

module.exports = { buscarFixtureParaPick, normalizarNomeTime, separarConfronto };
