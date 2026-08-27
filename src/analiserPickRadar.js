'use strict';

const { montarSystemPromptEngine1 } = require('./systemPromptEngine1');
const { montarSystemPromptEngine2Narrador } = require('./systemPromptEngine2Narrador');
const { chamarGeminiComRetry } = require('./geminiService');
const { chamarGroqComRetry } = require('./groqService');
const { chamarMotorQuant } = require('./motorQuantBridge');

/**
 * analiserPickRadar.js
 *
 * Pipeline pros 5 picks brutos que vêm do Moneyball Radar (Scanner): dado
 * bruto do print (mercado + odd visível + contexto do OCR) entra, análise
 * completa sai — reaproveitando EXATAMENTE a mesma divisão de trabalho que
 * já existe pro fluxo do cron (analiserFixture.js), só trocando o gatilho:
 *
 *   Gemini (Engine 1) investiga — usa o que o OCR já capturou como PONTO DE
 *     PARTIDA, confirma/completa via busca real, faz a leitura de
 *     correlações/game script.
 *   Moneyball Pro (motor quant) calcula — probabilidade real via distribuição
 *     estatística (nunca a IA "achando" o número). Ver motorQuantBridge.js --
 *     desde 2026 isso deixou de ser um motor Python local (api/quant/) e
 *     virou chamada HTTP pro Moneyball Pro, que é o motor de cálculo único
 *     do produto (evita ter duas implementações de Poisson/EV/Kelly
 *     divergindo com o tempo).
 *   Groq (Engine 2 Narrador) escreve — só texto em cima dos números prontos.
 *
 * Diferença do analiserFixture.js: lá o Engine 1 parte do zero (só
 * casa/visitante/liga). Aqui ele já recebe o que o OCR encontrou no print
 * como semente — ainda tem que confirmar via busca (LEIS_GERAIS do Engine 1
 * já exige isso), mas não começa cego.
 */

// Esportes cujo motor quant já existe (agora no Moneyball Pro, ver
// motorQuantBridge.js). O que não está aqui cai fora com erro explícito --
// nunca finge que rodou um cálculo que não existe.
const ROTA_QUANT_POR_ESPORTE = {
  futebol: 'futebol',
  beisebol: 'beisebol',
  basquete: 'basquete',
  nba: 'basquete',
  wnba: 'basquete',
};

/** Decide a chave de esporte que o Engine 1 (systemPromptEngine1.js) espera. */
function chaveEngine1(pickBruto) {
  const esporte = String(pickBruto.esporte || '').toLowerCase();
  if (esporte === 'basquete') {
    const liga = String(pickBruto.league || '').toLowerCase();
    return liga.includes('wnba') ? 'wnba' : 'basquete';
  }
  return esporte;
}

/**
 * Instrução adicional ao Engine 1 quando já existe dado de OCR do print —
 * NÃO substitui as LEIS_GERAIS (ainda precisa confirmar via busca real),
 * só evita que ele comece do zero ignorando o que o print já mostrou.
 */
function montarAddendumDadosBrutos() {
  return `

### DADO ADICIONAL: O USUÁRIO JÁ ENVIOU UM RECORTE DO QUE VIU NO PRINT

O payload do usuário inclui "dados_capturados_no_print" — mercado(s), odd(s)
e contexto que já foram lidos via OCR do print da casa de apostas. Use isso
como PONTO DE PARTIDA, não como verdade absoluta: confirme via busca (regra
2 das Leis Gerais já exige isso), mas não ignore essa semente nem repita
buscas que ela já resolveu (ex: se a odd já veio nítida do print, não
precisa buscar a odd de novo — precisa confirmar que ainda está no ar/não
mudou, se a busca permitir).`.trim();
}

/**
 * analisarPickRadar(fixture, pickBruto, opcoes)
 *
 * @param {Object} fixture - resultado de radarMatcher.buscarFixtureParaPick (encontrado:true)
 * @param {Object} pickBruto - { esporte, match, league, mercados_visiveis_no_print, contexto_ocr }
 * @param {Object} opcoes - { geminiApiKey, groqApiKey } opcionais, senão usa env vars
 * @returns {Promise<Object>} mesmo shape que analiserFixture.js produz —
 *   { sucesso, esporte, casa, visitante, liga, game_script, resumo_tecnico, analise_completa }
 *   ou { sucesso:false, etapa, erros } em caso de falha em qualquer etapa.
 */
async function analisarPickRadar(fixture, pickBruto, opcoes = {}) {
  const inicio = Date.now();
  const esporteBruto = String(pickBruto.esporte || '').toLowerCase();
  const rotaQuant = ROTA_QUANT_POR_ESPORTE[esporteBruto];

  if (!rotaQuant) {
    return {
      sucesso: false,
      etapa: 'validacao',
      erros: [`Esporte "${pickBruto.esporte}" ainda não tem motor quant Python — só futebol/basquete/wnba/beisebol.`],
    };
  }

  const engine1Key = chaveEngine1(pickBruto);
  let systemPromptEngine1;
  try {
    systemPromptEngine1 = montarSystemPromptEngine1(engine1Key) + montarAddendumDadosBrutos();
  } catch (erro) {
    return { sucesso: false, etapa: 'validacao', erros: [erro.message] };
  }

  // ETAPA 1 — Gemini investiga, semeado pelo que o OCR já capturou.
  let resultadoEngine1;
  try {
    resultadoEngine1 = await chamarGeminiComRetry({
      apiKey: opcoes.geminiApiKey || process.env.GEMINI_API_KEY,
      systemPrompt: systemPromptEngine1,
      payload: {
        casa: fixture.timeCasa,
        visitante: fixture.timeVisitante,
        liga: fixture.ligaNome || pickBruto.league,
        dados_capturados_no_print: {
          mercados_visiveis: pickBruto.mercados_visiveis_no_print || [],
          contexto_ocr: pickBruto.contexto_ocr || null,
        },
      },
      usarGrounding: true,
    });
  } catch (erro) {
    return { sucesso: false, etapa: 'engine1_chamada', erros: [erro.message], tempo_ms: Date.now() - inicio };
  }

  if (resultadoEngine1.parseError || !resultadoEngine1.parsed) {
    return {
      sucesso: false,
      etapa: 'engine1_parse',
      erros: [`JSON inválido do Engine 1: ${resultadoEngine1.parseError}`],
      resposta_bruta: resultadoEngine1.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  const dadosEngine1 = resultadoEngine1.parsed;

  // ETAPA 2 — Python calcula (nunca a IA).
  let resultadoQuant;
  try {
    resultadoQuant = await chamarMotorQuant(rotaQuant, {
      esporte: engine1Key === 'wnba' ? 'wnba' : rotaQuant,
      estatisticas: dadosEngine1.estatisticas,
      odds: dadosEngine1.odds,
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'motor_quant',
      erros: [erro.message],
      engine1_output: dadosEngine1,
      tempo_ms: Date.now() - inicio,
    };
  }

  // ETAPA 3 — Groq só escreve, nunca recalcula.
  let resultadoGroq;
  try {
    resultadoGroq = await chamarGroqComRetry({
      apiKey: opcoes.groqApiKey || process.env.GROQ_API_KEY,
      systemPrompt: montarSystemPromptEngine2Narrador(),
      engine1Output: {
        game_script: dadosEngine1.game_script ?? null, // só existe pra futebol hoje
        contexto: dadosEngine1.contexto ?? null, // dá algo pro narrador puxar quando não há game_script
        mercados_calculados: resultadoQuant.mercados_calculados,
        bilhete_recomendado: resultadoQuant.bilhete_recomendado,
      },
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'engine2_narrador_chamada',
      erros: [erro.message],
      quant_output: resultadoQuant,
      tempo_ms: Date.now() - inicio,
    };
  }

  if (resultadoGroq.parseError || !resultadoGroq.parsed) {
    return {
      sucesso: false,
      etapa: 'engine2_narrador_parse',
      erros: [`JSON inválido do Groq: ${resultadoGroq.parseError}`],
      resposta_bruta: resultadoGroq.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  return {
    sucesso: true,
    esporte: esporteBruto,
    casa: fixture.timeCasa,
    visitante: fixture.timeVisitante,
    liga: fixture.ligaNome || pickBruto.league,
    game_script: dadosEngine1.game_script ?? null,
    resumo_tecnico: resultadoGroq.parsed.resumo_tecnico ?? null,
    analise_completa: resultadoGroq.parsed.analise_completa ?? [],
    tempo_ms: Date.now() - inicio,
  };
}

module.exports = { analisarPickRadar };
