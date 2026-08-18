'use strict';

const fs = require('fs');
const path = require('path');

function carregarTimesGrandes() {
  const caminho = path.join(process.cwd(), 'config', 'times-marquee.json');
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return JSON.parse(conteudo).times_grandes;
}

const PESO_TIME_GRANDE = 3;
const PESO_MOVIMENTO_ODDS = 1;

/**
 * calcularMovimentoOdds(snapshotsOdds)
 * Diferença absoluta entre a primeira e a última odd capturada do mercado
 * principal (moneyline/1x2, seleção "casa" quando existir) — proxy simples
 * de "quanto o mercado se mexeu", sem ser o cálculo de GLV de verdade (esse
 * é do outro app, aqui é só um sinal auxiliar de ranking).
 */
function calcularMovimentoOdds(snapshotsOdds) {
  const relevantes = snapshotsOdds.filter((s) =>
    /moneyline|1x2|match winner/i.test(s.mercado)
  );
  if (relevantes.length < 2) return 0;

  const porSelecao = {};
  for (const s of relevantes) {
    if (!porSelecao[s.selecao]) porSelecao[s.selecao] = [];
    porSelecao[s.selecao].push(Number(s.valor));
  }

  let maiorMovimento = 0;
  for (const valores of Object.values(porSelecao)) {
    if (valores.length < 2) continue;
    const movimento = Math.abs(valores[valores.length - 1] - valores[0]);
    maiorMovimento = Math.max(maiorMovimento, movimento);
  }
  return maiorMovimento;
}

/**
 * calcularScoreDeHype(fixture)
 * @param {Object} fixture - item de db.obterFixturesDoDiaComOdds()
 * @returns {{ score: number, motivos: string[] }}
 */
function calcularScoreDeHype(fixture) {
  const timesGrandesPorLiga = carregarTimesGrandes();
  const timesGrandes = timesGrandesPorLiga[String(fixture.ligaApiSportsId)] || [];

  const motivos = [];
  let score = 0;

  const casaEhGrande = timesGrandes.includes(fixture.timeCasa);
  const visitanteEhGrande = timesGrandes.includes(fixture.timeVisitante);

  if (casaEhGrande) {
    score += PESO_TIME_GRANDE;
    motivos.push(`${fixture.timeCasa} é time grande`);
  }
  if (visitanteEhGrande) {
    score += PESO_TIME_GRANDE;
    motivos.push(`${fixture.timeVisitante} é time grande`);
  }
  if (casaEhGrande && visitanteEhGrande) {
    motivos.push('Clássico entre times grandes');
  }

  const movimento = calcularMovimentoOdds(fixture.snapshotsOdds || []);
  if (movimento > 0) {
    score += movimento * PESO_MOVIMENTO_ODDS;
    motivos.push(`Movimento de odds: ${movimento.toFixed(2)}`);
  }

  return { score: Number(score.toFixed(2)), motivos };
}

/** rankearFixturesPorHype(fixtures) — ordena do maior pro menor score. */
function rankearFixturesPorHype(fixtures) {
  return fixtures
    .map((fixture) => ({ ...fixture, hype: calcularScoreDeHype(fixture) }))
    .sort((a, b) => b.hype.score - a.hype.score);
}

module.exports = { calcularScoreDeHype, rankearFixturesPorHype };
