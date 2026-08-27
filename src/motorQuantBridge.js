'use strict';

/**
 * Ponte pro motor de cálculo do Moneyball Pro -- SUBSTITUI o antigo
 * api/quant/{futebol,basquete,beisebol}.py, que era um motor quant paralelo,
 * mantido separadamente aqui no smartcenter (duplicando Poisson/Skellam/EV/
 * Kelly que já existiam, testados, no Moneyball Pro).
 *
 * Mantém EXATAMENTE o mesmo contrato de entrada/saída que
 * chamarMotorQuant()/chamarMotorQuantFutebol() já tinham -- quem chama esta
 * função (analiserPickRadar.js, analiserFixture.js) não precisa mudar nada
 * além do require().
 *
 * Entrada:  { esporte, estatisticas, odds }
 * Saída:    { sucesso, lambda_casa, lambda_visitante, mercados_calculados, bilhete_recomendado }
 *           ou { sucesso: false, erro }
 *
 * Por dentro, faz 2 chamadas HTTP pro Moneyball Pro:
 *   1. POST /api/v1/lambda   -- estatisticas brutas -> lambda_casa/lambda_visitante
 *   2. POST /api/v1/calc     -- lambdas + odds -> probabilidade/EV/Kelly por mercado
 * Nenhuma matemática de aposta roda em JS -- só tradução de formato.
 */

function baseUrlMoneyballPro() {
  return process.env.MONEYBALL_PRO_BASE_URL || 'https://app.moneyballpro.com.br';
}

// Tags de "direção" -- usadas só pra correlação heurística entre mercados no
// bilhete recomendado, não é modelagem estatística de covariância real (o
// Moneyball Pro já tem algo mais rigoroso pra isso -- Matchup Engine -- mas
// esse bilhete aqui é só uma pré-seleção pro Radar, não o produto final).
const TAG_CASA_DOMINA = 'casa_domina';
const TAG_GOLS_ALTOS = 'gols_altos';
const TAG_GOLS_BAIXOS = 'gols_baixos';
const TAG_VISITANTE = 'visitante';

function correlacao(tagA, tagB) {
  if (tagA === tagB) return 'Positiva';
  const opostos = new Set([
    `${TAG_CASA_DOMINA}|${TAG_VISITANTE}`, `${TAG_VISITANTE}|${TAG_CASA_DOMINA}`,
    `${TAG_GOLS_ALTOS}|${TAG_GOLS_BAIXOS}`, `${TAG_GOLS_BAIXOS}|${TAG_GOLS_ALTOS}`,
  ]);
  if (opostos.has(`${tagA}|${tagB}`)) return 'Negativa';
  return 'Neutra';
}

function unidadesPorEdge(edge) {
  if (edge === null || edge === undefined) return 0;
  if (edge >= 0.10) return 2.0;
  if (edge >= 0.05) return 1.0;
  if (edge >= 0.02) return 0.5;
  return 0;
}

/** Converte um resultado do /api/v1/calc (probabilidade + odd) num item no
 * formato "mercados_calculados" que a narração (Groq) já espera. */
function montarItem(mercadoNome, odd, probabilidadeEstimada, tag) {
  if (!odd || probabilidadeEstimada === null || probabilidadeEstimada === undefined) return null;
  const probabilidadeImplicita = 1 / odd;
  const edge = probabilidadeEstimada - probabilidadeImplicita;
  const betTo = probabilidadeEstimada > 0 ? Math.round((1 / probabilidadeEstimada) * 1000) / 1000 : null;
  return {
    mercado: mercadoNome,
    odd,
    probabilidade_estimada: Math.round(probabilidadeEstimada * 10000) / 10000,
    probabilidade_implicita: Math.round(probabilidadeImplicita * 10000) / 10000,
    edge: Math.round(edge * 10000) / 10000,
    bet_to: betTo,
    unidades_recomendadas: unidadesPorEdge(edge),
    possivel_vies_se_edge_alto: edge > 0.10,
    tag_correlacao: tag,
  };
}

function montarBilheteRecomendado(candidatos) {
  const elegiveis = candidatos
    .filter((c) => c.edge !== null && c.edge >= 0.02)
    .sort((a, b) => b.edge - a.edge);

  const bilhete = [];
  for (const candidato of elegiveis) {
    if (bilhete.length >= 3) break;
    const contradiz = bilhete.some((j) => correlacao(candidato.tag_correlacao, j.tag_correlacao) === 'Negativa');
    if (!contradiz) bilhete.push(candidato);
  }
  return bilhete;
}

async function chamarMoneyballPro(caminho, body) {
  const url = `${baseUrlMoneyballPro()}${caminho}`;
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = dados?.detail || `HTTP ${resposta.status}`;
    throw new Error(`Moneyball Pro (${caminho}) respondeu erro: ${erro}`);
  }
  return dados;
}

/** Constrói os mercados[] pro /api/v1/calc a partir do "odds" no formato que
 * o Engine 1 (Gemini) já produz -- só entra mercado pra que existe odd real,
 * igual o motor antigo fazia (nunca inventa mercado). */
function montarMercadosParaCalc(esporte, odds, lamA, lamB) {
  const mercados = [];
  let contador = 0;
  const proximoId = () => `m${++contador}`;

  const ml = odds.moneyline_1x2 || odds.moneyline || {};
  if (esporte === 'futebol') {
    if (ml.casa || ml.visitante || ml.empate) {
      mercados.push({
        id: proximoId(), tipo: 'moneyline_1x2', lam_a: lamA, lam_b: lamB,
        odd_a: ml.casa, odd_empate: ml.empate, odd_b: ml.visitante,
      });
    }
  } else if (ml.casa || ml.visitante) {
    mercados.push({
      id: proximoId(), tipo: 'moneyline', lam_a: lamA, lam_b: lamB,
      modelo: esporte === 'basquete' ? 'normal' : 'skellam',
      odd_a: ml.casa, odd_b: ml.visitante,
    });
  }

  for (const linhaObj of (odds.gols_over_under || odds.total_over_under || [])) {
    if (linhaObj?.linha === undefined || linhaObj?.linha === null) continue;
    if (linhaObj.over) {
      mercados.push({
        id: proximoId(), linha: linhaObj.linha, media_esperada: lamA + lamB,
        odd_real_decimal: linhaObj.over, lado_odd: 'over',
      });
    }
    if (linhaObj.under) {
      mercados.push({
        id: proximoId(), linha: linhaObj.linha, media_esperada: lamA + lamB,
        odd_real_decimal: linhaObj.under, lado_odd: 'under',
      });
    }
  }

  const btts = odds.ambas_marcam || odds.btts || {};
  if (btts.sim || btts.nao) {
    mercados.push({
      id: proximoId(), tipo: 'btts', lam_a: lamA, lam_b: lamB,
      odd_sim: btts.sim, odd_nao: btts.nao,
    });
  }

  for (const linhaObj of (odds.handicap_asiatico || [])) {
    if (linhaObj?.linha === undefined || linhaObj?.linha === null) continue;
    if (linhaObj.casa) {
      mercados.push({
        id: proximoId(), tipo: 'handicap_asiatico', lam_a: lamA, lam_b: lamB,
        linha: linhaObj.linha, time_referencia: 'A', odd: linhaObj.casa,
      });
    }
    if (linhaObj.visitante) {
      mercados.push({
        id: proximoId(), tipo: 'handicap_asiatico', lam_a: lamA, lam_b: lamB,
        linha: -linhaObj.linha, time_referencia: 'B', odd: linhaObj.visitante,
      });
    }
  }

  return mercados;
}

/** Traduz os resultados crus do /api/v1/calc de volta pro formato
 * "mercados_calculados" (nome de mercado + tag de correlação legível) que a
 * narração já espera. */
function traduzirResultadosParaCandidatos(esporte, resultados, odds) {
  const candidatos = [];
  let i = 0;

  const ml = odds.moneyline_1x2 || odds.moneyline || {};
  const overUnder = odds.gols_over_under || odds.total_over_under || [];
  const btts = odds.ambas_marcam || odds.btts || {};
  const handicaps = odds.handicap_asiatico || [];

  // A ordem de montagem aqui precisa espelhar exatamente montarMercadosParaCalc
  // acima, já que estamos pareando por posição na lista de resultados.
  if (esporte === 'futebol' ? (ml.casa || ml.visitante || ml.empate) : (ml.casa || ml.visitante)) {
    const r = resultados[i++];
    if (esporte === 'futebol') {
      if (r.probabilidade_a !== null) { const it = montarItem('Moneyline (1X2) - Casa', ml.casa, r.probabilidade_a, TAG_CASA_DOMINA); if (it) candidatos.push(it); }
      if (r.probabilidade_b !== null) { const it = montarItem('Moneyline (1X2) - Visitante', ml.visitante, r.probabilidade_b, TAG_VISITANTE); if (it) candidatos.push(it); }
    } else {
      if (r.probabilidade_a !== null) { const it = montarItem('Moneyline - Casa', ml.casa, r.probabilidade_a, TAG_CASA_DOMINA); if (it) candidatos.push(it); }
      if (r.probabilidade_b !== null) { const it = montarItem('Moneyline - Visitante', ml.visitante, r.probabilidade_b, TAG_VISITANTE); if (it) candidatos.push(it); }
    }
  }

  for (const linhaObj of overUnder) {
    if (linhaObj?.linha === undefined || linhaObj?.linha === null) continue;
    if (linhaObj.over) {
      const r = resultados[i++];
      const it = montarItem(`Over ${linhaObj.linha}`, linhaObj.over, r.probabilidade_over, TAG_GOLS_ALTOS);
      if (it) candidatos.push(it);
    }
    if (linhaObj.under) {
      const r = resultados[i++];
      const it = montarItem(`Under ${linhaObj.linha}`, linhaObj.under, r.probabilidade_under, TAG_GOLS_BAIXOS);
      if (it) candidatos.push(it);
    }
  }

  if (btts.sim || btts.nao) {
    const r = resultados[i++];
    if (btts.sim) { const it = montarItem('Ambas Marcam - Sim', btts.sim, r.probabilidade_sim, TAG_GOLS_ALTOS); if (it) candidatos.push(it); }
    if (btts.nao) { const it = montarItem('Ambas Marcam - Não', btts.nao, r.probabilidade_nao, TAG_GOLS_BAIXOS); if (it) candidatos.push(it); }
  }

  for (const linhaObj of handicaps) {
    if (linhaObj?.linha === undefined || linhaObj?.linha === null) continue;
    if (linhaObj.casa) {
      const r = resultados[i++];
      const it = montarItem(`Handicap Asiático Casa ${linhaObj.linha}`, linhaObj.casa, r.probabilidade_cobre, TAG_CASA_DOMINA);
      if (it) candidatos.push(it);
    }
    if (linhaObj.visitante) {
      const r = resultados[i++];
      const it = montarItem(`Handicap Asiático Visitante ${-linhaObj.linha}`, linhaObj.visitante, r.probabilidade_cobre, TAG_VISITANTE);
      if (it) candidatos.push(it);
    }
  }

  return candidatos;
}

/**
 * Substitui chamarMotorQuant()/chamarMotorQuantFutebol() antigos -- mesmo
 * contrato externo, motor por baixo trocado.
 */
async function chamarMotorQuant(rotaEsporteIgnorada, payload) {
  const esporte = (payload?.esporte || '').toLowerCase();
  const estatisticas = payload?.estatisticas || {};
  const odds = payload?.odds || {};

  let lambdaResp;
  try {
    lambdaResp = await chamarMoneyballPro('/api/v1/lambda', { esporte, estatisticas });
  } catch (erro) {
    return { sucesso: false, erro: `Falha ao calcular lambda no Moneyball Pro: ${erro.message}` };
  }
  if (!lambdaResp.sucesso) {
    return { sucesso: false, erro: lambdaResp.erro };
  }
  const { lambda_casa: lambdaCasa, lambda_visitante: lambdaVisitante } = lambdaResp;

  const overUnderComProbabilidade = (odds.gols_over_under || odds.total_over_under || []).flatMap((linhaObj) => {
    // /api/v1/calc (over/under) devolve "probabilidade_over"/"probabilidade_under"
    // já no mesmo objeto -- não precisa de tradução extra além do nome do
    // mercado, já tratado em traduzirResultadosParaCandidatos.
    return [];
  });
  void overUnderComProbabilidade; // só documentação -- ver montarMercadosParaCalc/traduzir acima

  const mercados = montarMercadosParaCalc(esporte, odds, lambdaCasa, lambdaVisitante);
  if (mercados.length === 0) {
    return {
      sucesso: true, lambda_casa: lambdaCasa, lambda_visitante: lambdaVisitante,
      mercados_calculados: [], bilhete_recomendado: [],
    };
  }

  let calcResp;
  try {
    calcResp = await chamarMoneyballPro('/api/v1/calc', { esporte, mercados });
  } catch (erro) {
    return { sucesso: false, erro: `Falha ao calcular mercados no Moneyball Pro: ${erro.message}` };
  }

  const candidatos = traduzirResultadosParaCandidatos(esporte, calcResp.resultados || [], odds);
  const bilhete = montarBilheteRecomendado(candidatos);

  return {
    sucesso: true,
    lambda_casa: lambdaCasa,
    lambda_visitante: lambdaVisitante,
    mercados_calculados: candidatos,
    bilhete_recomendado: bilhete,
  };
}

module.exports = { chamarMotorQuant };
