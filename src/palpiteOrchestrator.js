'use strict';

const { montarSystemPromptEngine1, ESPORTES } = require('./systemPromptEngine1');
const { montarSystemPromptEngine2 } = require('./systemPromptEngine2');
const { chamarGeminiComRetry } = require('./geminiService');
const { chamarGroqComRetry } = require('./groqService');
const { MODULES } = require('./sportModules');

/**
 * gerarPalpitePartida({ esporte, casa, visitante, liga })
 *
 * Orquestra o fluxo completo de uma partida:
 *   1) Engine 1 (Gemini + grounding): pesquisa e estrutura odds/estatísticas/contexto
 *   2) Engine 2 (Groq): calcula EV/robustez/confiabilidade a partir do que o Engine 1 achou
 *
 * Nunca lança para falha de negócio esperada (esporte não suportado, parse
 * inválido) — sempre devolve um objeto estruturado com "sucesso" e "etapa".
 *
 * @param {Object} partida
 * @param {string} partida.esporte - uma chave de ESPORTES (systemPromptEngine1.js)
 * @param {string} partida.casa
 * @param {string} partida.visitante
 * @param {string} [partida.liga]
 * @param {Object} [opcoes]
 * @param {string} [opcoes.geminiApiKey] - default: process.env.GEMINI_API_KEY
 * @param {string} [opcoes.groqApiKey] - default: process.env.GROQ_API_KEY
 * @returns {Promise<Object>} resposta padronizada
 */
async function gerarPalpitePartida(partida, opcoes = {}) {
  const inicio = Date.now();
  const esporte = String(partida?.esporte || '').trim().toLowerCase();

  if (!ESPORTES[esporte] || !MODULES[esporte]) {
    return {
      sucesso: false,
      etapa: 'validacao',
      erros: [`Esporte não suportado: "${partida?.esporte}". Válidos: ${Object.keys(MODULES).join(', ')}.`],
      tempo_ms: Date.now() - inicio,
    };
  }

  if (!partida?.casa || !partida?.visitante) {
    return {
      sucesso: false,
      etapa: 'validacao',
      erros: ['"casa" e "visitante" são obrigatórios.'],
      tempo_ms: Date.now() - inicio,
    };
  }

  // ---------- ENGINE 1 (Gemini) ----------
  const promptEngine1 = montarSystemPromptEngine1(esporte);
  const entradaEngine1 = {
    esporte,
    liga: partida.liga ?? null,
    casa: partida.casa,
    visitante: partida.visitante,
  };

  let resultadoEngine1;
  try {
    resultadoEngine1 = await chamarGeminiComRetry({
      apiKey: opcoes.geminiApiKey || process.env.GEMINI_API_KEY,
      systemPrompt: promptEngine1,
      payload: entradaEngine1,
      usarGrounding: true,
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'engine1_chamada',
      erros: [erro.message],
      tempo_ms: Date.now() - inicio,
    };
  }

  if (resultadoEngine1.parseError || !resultadoEngine1.parsed) {
    return {
      sucesso: false,
      etapa: 'engine1_parse',
      erros: [`JSON inválido do Engine 1 (Gemini): ${resultadoEngine1.parseError}`],
      engine1_resposta_bruta: resultadoEngine1.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  const dadosEngine1 = resultadoEngine1.parsed;

  // ---------- ENGINE 2 (Groq) ----------
  const modulo = MODULES[esporte];
  const promptEngine2 = montarSystemPromptEngine2(modulo);

  let resultadoEngine2;
  try {
    resultadoEngine2 = await chamarGroqComRetry({
      apiKey: opcoes.groqApiKey || process.env.GROQ_API_KEY,
      systemPrompt: promptEngine2,
      engine1Output: dadosEngine1,
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'engine2_chamada',
      erros: [erro.message],
      engine1_output: dadosEngine1, // preservado — o Engine 1 funcionou, só o Engine 2 falhou
      tempo_ms: Date.now() - inicio,
    };
  }

  if (resultadoEngine2.parseError || !resultadoEngine2.parsed) {
    return {
      sucesso: false,
      etapa: 'engine2_parse',
      erros: [`JSON inválido do Engine 2 (Groq): ${resultadoEngine2.parseError}`],
      engine1_output: dadosEngine1,
      engine2_resposta_bruta: resultadoEngine2.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  return {
    sucesso: true,
    etapa: 'concluido',
    esporte,
    casa: partida.casa,
    visitante: partida.visitante,
    liga: dadosEngine1.liga ?? partida.liga ?? null,
    engine1_output: dadosEngine1,
    resumo_tecnico: resultadoEngine2.parsed.resumo_tecnico ?? null,
    analise_completa: resultadoEngine2.parsed.analise_completa ?? [],
    erros: [],
    tempo_ms: Date.now() - inicio,
  };
}

module.exports = { gerarPalpitePartida };
