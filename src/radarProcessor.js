'use strict';

const { montarSystemPrompt } = require('./systemPrompt');
const { chamarGeminiComRetry } = require('./geminiService');

const ESPORTES_SUPORTADOS = ['futebol', 'beisebol', 'basquete'];

/**
 * Valida o shape mínimo do payload vindo do Radar Engine.
 * Não valida REGRAS de negócio (isso é papel da IA/travas) — só garante
 * que os blocos e campos essenciais existem antes de gastar uma chamada à Gemini.
 *
 * @returns {{ valido: boolean, erros: string[] }}
 */
function validarPayloadRadar(payload) {
  const erros = [];

  if (!payload || typeof payload !== 'object') {
    return { valido: false, erros: ['Payload ausente ou não é um objeto JSON.'] };
  }

  const evento = payload.evento;
  if (!evento || typeof evento !== 'object') {
    erros.push('Bloco "evento" ausente.');
  } else {
    if (!evento.id_partida) erros.push('"evento.id_partida" ausente.');
    if (!evento.esporte) erros.push('"evento.esporte" ausente.');
    if (evento.esporte && !ESPORTES_SUPORTADOS.includes(String(evento.esporte).toLowerCase())) {
      erros.push(
        `"evento.esporte" = "${evento.esporte}" não suportado. Válidos: ${ESPORTES_SUPORTADOS.join(', ')}.`
      );
    }
    if (!evento.confronto?.mandante || !evento.confronto?.visitante) {
      erros.push('"evento.confronto.mandante" e/ou "evento.confronto.visitante" ausentes.');
    }
  }

  if (!payload.cotacoes_odds_api || typeof payload.cotacoes_odds_api !== 'object') {
    erros.push('Bloco "cotacoes_odds_api" ausente — sem cotações não há mercado para o pódio.');
  } else if (Object.keys(payload.cotacoes_odds_api).length === 0) {
    erros.push('Bloco "cotacoes_odds_api" está vazio.');
  }

  if (!payload.metricas_sports_api || typeof payload.metricas_sports_api !== 'object') {
    erros.push('Bloco "metricas_sports_api" ausente — sem estatística não há travas confiáveis.');
  }

  if (!payload.pre_calculos_radar || typeof payload.pre_calculos_radar !== 'object') {
    erros.push('Bloco "pre_calculos_radar" ausente — travas_automaticas são obrigatórias.');
  } else if (!payload.pre_calculos_radar.travas_automaticas) {
    erros.push('"pre_calculos_radar.travas_automaticas" ausente.');
  }

  return { valido: erros.length === 0, erros };
}

/**
 * processarPartidaRadar(payloadJSON)
 *
 * Orquestra o fluxo completo:
 *   1) valida o payload do Radar Engine
 *   2) monta o System Prompt rígido do esporte correspondente
 *   3) chama a Gemini API (com retry/backoff já embutido no geminiService)
 *   4) devolve resposta padronizada (nunca lança para o chamador em erro de
 *      negócio esperado — erro vira { sucesso: false, ... } estruturado;
 *      só lança em falha de configuração, ex: API key ausente)
 *
 * @param {Object} payloadJSON - payload vindo do Radar Engine (ver contrato de entrada)
 * @param {Object} [opcoes]
 * @param {string} [opcoes.apiKey] - default: process.env.GEMINI_API_KEY
 * @param {string} [opcoes.model] - default: gemini-1.5-pro (ver geminiService)
 * @returns {Promise<Object>} resposta padronizada
 */
async function processarPartidaRadar(payloadJSON, opcoes = {}) {
  const inicio = Date.now();
  const apiKey = opcoes.apiKey || process.env.GEMINI_API_KEY;
  const model = opcoes.model;

  const { valido, erros } = validarPayloadRadar(payloadJSON);

  if (!valido) {
    return {
      sucesso: false,
      etapa: 'validacao',
      id_partida: payloadJSON?.evento?.id_partida ?? null,
      erros,
      podio: null,
      tempo_ms: Date.now() - inicio,
    };
  }

  const esporte = String(payloadJSON.evento.esporte).toLowerCase();

  let systemPrompt;
  try {
    systemPrompt = montarSystemPrompt(esporte);
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'system_prompt',
      id_partida: payloadJSON.evento.id_partida,
      erros: [erro.message],
      podio: null,
      tempo_ms: Date.now() - inicio,
    };
  }

  let resultadoGemini;
  try {
    resultadoGemini = await chamarGeminiComRetry({
      apiKey,
      systemPrompt,
      payload: payloadJSON,
      usarGrounding: opcoes.usarGrounding ?? true, // default true — o pipeline depende de dados externos reais
      model,
    });
  } catch (erro) {
    // Falha de infraestrutura (API key ausente, todas as tentativas esgotadas, etc.)
    return {
      sucesso: false,
      etapa: 'chamada_gemini',
      id_partida: payloadJSON.evento.id_partida,
      erros: [erro.message],
      podio: null,
      tempo_ms: Date.now() - inicio,
    };
  }

  const { raw, parsed, parseError } = resultadoGemini;

  if (parseError || !parsed) {
    return {
      sucesso: false,
      etapa: 'parse_resposta',
      id_partida: payloadJSON.evento.id_partida,
      erros: [`JSON inválido retornado pela Gemini: ${parseError}`],
      resposta_bruta: raw, // preservado para auditoria/debug, nunca descartado
      podio: null,
      tempo_ms: Date.now() - inicio,
    };
  }

  if (!parsed.podio) {
    return {
      sucesso: false,
      etapa: 'validacao_estrutura',
      id_partida: payloadJSON.evento.id_partida,
      erros: ['Resposta da Gemini não contém a chave "podio".'],
      resposta_bruta: raw,
      podio: null,
      tempo_ms: Date.now() - inicio,
    };
  }

  return {
    sucesso: true,
    etapa: 'concluido',
    id_partida: payloadJSON.evento.id_partida,
    esporte,
    liga: payloadJSON.evento.liga ?? null,
    confronto: payloadJSON.evento.confronto,
    podio: parsed.podio,
    posicoes_vazias: parsed.posicoes_vazias ?? null,
    alertas: parsed.alertas ?? [],
    erros: [],
    tempo_ms: Date.now() - inicio,
  };
}

module.exports = { processarPartidaRadar, validarPayloadRadar };
