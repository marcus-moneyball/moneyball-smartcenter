'use strict';

const db = require('./db');
const { montarSystemPromptContextoQualitativo } = require('./systemPromptContextoQualitativo');
const { montarSystemPromptEngine2 } = require('./systemPromptEngine2');
const { chamarGeminiComRetry } = require('./geminiService');
const { chamarGroqComRetry } = require('./groqService');
const { MODULES } = require('./sportModules');
const { publicarPalpiteNoGhost } = require('./ghostService');

/**
 * Esporte já vem gravado no fixture (coleta noturna grava por produto:
 * futebol/basquete/beisebol) — só repassa.
 */
function mapearEsporte(fixture) {
  return fixture.esporte;
}

/**
 * analisarEPublicarFixture(fixtureId)
 *
 * Fluxo: lê odds/stats do banco (já coletados) → Gemini busca só contexto
 * qualitativo → Groq calcula EV/robustez/palpite → publica rascunho no Ghost.
 *
 * @returns {Promise<Object>} resultado padronizado (nunca lança para erro de negócio)
 */
async function analisarEPublicarFixture(fixtureId, opcoes = {}) {
  const inicio = Date.now();

  const fixture = await db.obterFixturePorId(fixtureId);
  if (!fixture) {
    return { sucesso: false, etapa: 'busca_fixture', erros: [`Fixture ${fixtureId} não encontrado no banco.`] };
  }

  const esporte = mapearEsporte(fixture);
  const modulo = MODULES[esporte];

  // ---------- Gemini: só contexto qualitativo ----------
  let resultadoQualitativo;
  try {
    resultadoQualitativo = await chamarGeminiComRetry({
      apiKey: opcoes.geminiApiKey || process.env.GEMINI_API_KEY,
      systemPrompt: montarSystemPromptContextoQualitativo(),
      payload: { casa: fixture.time_casa, visitante: fixture.time_visitante, liga: fixture.liga_nome },
      usarGrounding: true,
    });
  } catch (erro) {
    return { sucesso: false, etapa: 'contexto_qualitativo', erros: [erro.message], tempo_ms: Date.now() - inicio };
  }

  if (resultadoQualitativo.parseError || !resultadoQualitativo.parsed) {
    return {
      sucesso: false,
      etapa: 'contexto_qualitativo_parse',
      erros: [`JSON inválido do contexto qualitativo: ${resultadoQualitativo.parseError}`],
      resposta_bruta: resultadoQualitativo.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  const contexto = resultadoQualitativo.parsed;

  // ---------- Monta o "Moneyball Engine JSON" combinando banco + Gemini ----------
  const payloadParaGroq = {
    esporte,
    liga: fixture.liga_nome,
    casa: fixture.time_casa,
    visitante: fixture.time_visitante,
    odds: fixture.oddsAtuais, // já vem do banco, cru — Groq interpreta
    estatisticas: { casa: fixture.statsCasa, visitante: fixture.statsVisitante }, // cache do banco, pode ser null
    resumo_casa: contexto.resumo_casa,
    resumo_visitante: contexto.resumo_visitante,
    desfalques_casa: contexto.desfalques_casa,
    desfalques_visitante: contexto.desfalques_visitante,
    sentimento_mercado: contexto.sentimento_mercado,
  };

  // ---------- Groq: calcula EV/robustez/palpite ----------
  let resultadoGroq;
  try {
    resultadoGroq = await chamarGroqComRetry({
      apiKey: opcoes.groqApiKey || process.env.GROQ_API_KEY,
      systemPrompt: montarSystemPromptEngine2(modulo),
      conteudoUsuario: payloadParaGroq,
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'engine2_chamada',
      erros: [erro.message],
      payload_engine1: payloadParaGroq,
      tempo_ms: Date.now() - inicio,
    };
  }

  if (resultadoGroq.parseError || !resultadoGroq.parsed) {
    return {
      sucesso: false,
      etapa: 'engine2_parse',
      erros: [`JSON inválido do Groq: ${resultadoGroq.parseError}`],
      resposta_bruta: resultadoGroq.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  const resultadoAnalise = {
    sucesso: true,
    esporte,
    casa: fixture.time_casa,
    visitante: fixture.time_visitante,
    liga: fixture.liga_nome,
    resumo_tecnico: resultadoGroq.parsed.resumo_tecnico ?? null,
    analise_completa: resultadoGroq.parsed.analise_completa ?? [],
  };

  // ---------- Publica no Ghost ----------
  let publicacao;
  try {
    publicacao = await publicarPalpiteNoGhost(resultadoAnalise);
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'publicacao_ghost',
      erros: [erro.message],
      analise: resultadoAnalise,
      tempo_ms: Date.now() - inicio,
    };
  }

  await db.marcarFixtureAprovado(fixtureId, true);

  return {
    sucesso: true,
    etapa: 'concluido',
    fixture_id: fixtureId,
    analise: resultadoAnalise,
    publicacao,
    tempo_ms: Date.now() - inicio,
  };
}

module.exports = { analisarEPublicarFixture };
