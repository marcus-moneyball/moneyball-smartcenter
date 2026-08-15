'use strict';

const { GoogleGenAI } = require('@google/genai');

/**
 * Serviço de integração com a Gemini API.
 * Responsabilidade única: enviar (systemPrompt + payload) e devolver a resposta
 * JÁ normalizada como texto JSON — NUNCA interpreta o conteúdo, isso é
 * responsabilidade de quem chama (radarProcessor.js).
 *
 * NOTA DE MIGRAÇÃO: trocado de @google/generative-ai para @google/genai.
 * Motivo: combinar Google Search grounding com responseMimeType "application/json"
 * só funciona de forma suportada nos modelos Gemini 3.x através do SDK novo —
 * nos modelos 1.5 (SDK antigo) a própria API rejeita essa combinação
 * ("Search Grounding can't be used with JSON/YAML/XML mode").
 */

// Sem grounding, um modelo mais leve/barato já resolve. Com grounding, um
// modelo com mais capacidade de síntese ajuda a lidar melhor com os
// resultados de busca — confirme os nomes mais recentes na documentação
// oficial do Gemini antes de trocar (nomes de modelo mudam com frequência).
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const DEFAULT_MODEL_GROUNDING = process.env.GEMINI_MODEL_GROUNDING || 'gemini-3.5-flash';

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 800; // 800ms, 1.6s, 3.2s, 6.4s...
const RETRYABLE_STATUS = new Set([429, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extrai o status HTTP de um erro lançado pelo SDK do Gemini. */
function extrairStatus(erro) {
  if (erro?.status) return erro.status;
  const match = /\b(\d{3})\b/.exec(erro?.message || '');
  return match ? Number(match[1]) : null;
}

function ehErroRetentavel(erro) {
  const status = extrairStatus(erro);
  return RETRYABLE_STATUS.has(status);
}

/**
 * Chama a Gemini API com retry + exponential backoff (com jitter) para
 * erros 429 (rate limit) e 503 (indisponibilidade temporária).
 *
 * @param {Object} params
 * @param {string} params.apiKey - Chave da Gemini API (nunca hardcoded, vem de env/secret)
 * @param {string} params.systemPrompt - Instruções rígidas do esporte (vindas de montarSystemPrompt)
 * @param {Object} params.payload - Payload do Radar Engine (será serializado em JSON)
 * @param {boolean} [params.usarGrounding] - Se true, habilita Google Search grounding
 *   (a Gemini busca dados externos reais em vez de só ler o payload). Exige modelo Gemini 3.x.
 * @param {string} [params.model] - Override do modelo. Se omitido, usa
 *   DEFAULT_MODEL_GROUNDING quando usarGrounding=true, senão DEFAULT_MODEL.
 * @param {number} [params.temperature] - Default 0.2 (respostas mais determinísticas para +EV)
 * @returns {Promise<{ raw: string, parsed: Object|null, parseError: string|null }>}
 */
async function chamarGeminiComRetry({
  apiKey,
  systemPrompt,
  payload,
  usarGrounding = false,
  model,
  temperature = 0.2,
}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY ausente — configure via variável de ambiente/secret.');
  }

  const modeloEfetivo = model || (usarGrounding ? DEFAULT_MODEL_GROUNDING : DEFAULT_MODEL);
  const ai = new GoogleGenAI({ apiKey });
  const userContent = JSON.stringify(payload);

  const config = {
    systemInstruction: systemPrompt,
    temperature,
    responseMimeType: 'application/json',
  };

  if (usarGrounding) {
    // Grounding com Google Search + JSON simultâneos só é suportado em
    // modelos Gemini 3.x. Se usarGrounding=true com um modelo mais antigo,
    // a própria API vai rejeitar — deixamos o erro subir claro em vez de
    // mascarar (falha explícita > resposta silenciosamente errada).
    config.tools = [{ googleSearch: {} }];
  }

  let ultimoErro = null;

  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa += 1) {
    try {
      const response = await ai.models.generateContent({
        model: modeloEfetivo,
        contents: userContent,
        config,
      });
      const raw = response.text;
      return normalizarResposta(raw);
    } catch (erro) {
      ultimoErro = erro;

      const retentavel = ehErroRetentavel(erro);
      const ultimaTentativa = tentativa === MAX_RETRIES;

      if (!retentavel || ultimaTentativa) {
        throw new Error(
          `Falha ao chamar Gemini API (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}, modelo=${modeloEfetivo}, grounding=${usarGrounding}): ${erro.message}`
        );
      }

      const delayBase = BASE_DELAY_MS * 2 ** tentativa;
      const jitter = Math.floor(Math.random() * 250);
      const delay = delayBase + jitter;

      // eslint-disable-next-line no-console
      console.warn(
        `[geminiService] erro retentável (status=${extrairStatus(erro)}), ` +
          `tentativa ${tentativa + 1}/${MAX_RETRIES + 1}, aguardando ${delay}ms`
      );

      await sleep(delay);
    }
  }

  // Nunca deveria chegar aqui — o loop sempre retorna ou lança antes.
  throw ultimoErro;
}

/**
 * Normaliza a resposta bruta do Gemini: remove eventuais fences de markdown
 * e blinda contra um bug conhecido do grounding+JSON (a resposta às vezes
 * vem cortada no início, começando no meio de uma frase/objeto). Nunca lança
 * — devolve parseError em vez disso, preservando "raw" sempre para auditoria.
 */
function normalizarResposta(rawTexto) {
  let texto = rawTexto
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(texto);
    return { raw: rawTexto, parsed, parseError: null };
  } catch (erroInicial) {
    // Defesa contra o bug de truncamento: tenta isolar o maior bloco entre
    // a primeira "{" e a última "}" antes de desistir.
    const inicio = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');

    if (inicio === -1 || fim === -1 || fim <= inicio) {
      return { raw: rawTexto, parsed: null, parseError: erroInicial.message };
    }

    const candidato = texto.slice(inicio, fim + 1);
    try {
      const parsed = JSON.parse(candidato);
      return { raw: rawTexto, parsed, parseError: null };
    } catch (erroFallback) {
      return { raw: rawTexto, parsed: null, parseError: erroFallback.message };
    }
  }
}

module.exports = { chamarGeminiComRetry };
