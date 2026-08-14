'use strict';

/**
 * Serviço de integração com a Groq API (Engine 2 — cálculo de EV/robustez).
 * Migrado do app antigo: era chamado direto do navegador com key colada
 * em runtime; agora roda no backend com GROQ_API_KEY como variável de
 * ambiente, nunca exposta ao cliente.
 *
 * Mesmo padrão de retry/backoff do geminiService.js, pra consistência.
 */

const DEFAULT_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 800;
const RETRYABLE_STATUS = new Set([429, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chama a Groq API (chat completions, formato OpenAI-compatible) com
 * retry + exponential backoff para 429/503.
 *
 * @param {Object} params
 * @param {string} params.apiKey - GROQ_API_KEY, nunca hardcoded
 * @param {string} params.systemPrompt - vem de montarSystemPromptEngine2(modulo)
 * @param {Object} params.engine1Output - o JSON que o Engine 1 (Gemini) gerou
 * @param {string} [params.model]
 * @param {number} [params.temperature] - default 0.2
 * @returns {Promise<{ raw: string, parsed: Object|null, parseError: string|null }>}
 */
async function chamarGroqComRetry({
  apiKey,
  systemPrompt,
  engine1Output,
  model = DEFAULT_MODEL,
  temperature = 0.2,
}) {
  if (!apiKey) {
    throw new Error('GROQ_API_KEY ausente — configure via variável de ambiente/secret.');
  }

  const userContent = JSON.stringify(engine1Output);
  let ultimoErro = null;

  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa += 1) {
    try {
      const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature,
          max_tokens: 6000,
          reasoning_effort: 'none',
          reasoning_format: 'hidden',
          response_format: { type: 'json_object' },
        }),
      });

      if (!resposta.ok) {
        const corpoErro = await resposta.text();
        const erro = new Error(`HTTP ${resposta.status}: ${corpoErro.slice(0, 300)}`);
        erro.status = resposta.status;
        throw erro;
      }

      const dados = await resposta.json();
      const conteudo = dados.choices?.[0]?.message?.content;

      if (!conteudo) {
        throw new Error('Resposta do Groq veio sem conteúdo (choices[0].message.content vazio).');
      }

      return normalizarResposta(conteudo);
    } catch (erro) {
      ultimoErro = erro;

      const retentavel = RETRYABLE_STATUS.has(erro.status);
      const ultimaTentativa = tentativa === MAX_RETRIES;

      if (!retentavel || ultimaTentativa) {
        throw new Error(
          `Falha ao chamar Groq API (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}, modelo=${model}): ${erro.message}`
        );
      }

      const delay = BASE_DELAY_MS * 2 ** tentativa + Math.floor(Math.random() * 250);

      // eslint-disable-next-line no-console
      console.warn(
        `[groqService] erro retentável (status=${erro.status}), tentativa ${tentativa + 1}/${MAX_RETRIES + 1}, aguardando ${delay}ms`
      );

      await sleep(delay);
    }
  }

  throw ultimoErro;
}

/** Mesma lógica de blindagem do geminiService.js — remove fences, isola {...} se vier truncado. */
function normalizarResposta(rawTexto) {
  const texto = rawTexto
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return { raw: rawTexto, parsed: JSON.parse(texto), parseError: null };
  } catch (erroInicial) {
    const inicio = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (inicio === -1 || fim === -1 || fim <= inicio) {
      return { raw: rawTexto, parsed: null, parseError: erroInicial.message };
    }
    try {
      return { raw: rawTexto, parsed: JSON.parse(texto.slice(inicio, fim + 1)), parseError: null };
    } catch (erroFallback) {
      return { raw: rawTexto, parsed: null, parseError: erroFallback.message };
    }
  }
}

module.exports = { chamarGroqComRetry };
