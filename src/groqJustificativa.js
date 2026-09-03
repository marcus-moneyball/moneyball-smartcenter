'use strict';

const Groq = require('groq-sdk');

/**
 * Groq é usado EXCLUSIVAMENTE para escrever texto -- nunca para calcular ou
 * decidir nada. A estrutura do relatório (Ouro/Prata/Bronze, odds,
 * probabilidades) é 100% determinística e vem do Pro; o Groq só recebe
 * esses números prontos + o contexto investigado e escreve a justificativa
 * em prosa. Fail-open: se falhar, cai numa justificativa padrão simples.
 *
 * Requer GROQ_API_KEY.
 */

let cliente = null;
function getCliente() {
  if (cliente) return cliente;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  cliente = new Groq({ apiKey });
  return cliente;
}

/**
 * @param {Object} posicao - uma posição do pódio { mercado, selecao, odd, probabilidade_estimada }
 * @param {Object} contexto - { fatoresIncerteza, evento }
 * @returns {Promise<string>} justificativa curta (1-2 frases)
 */
async function escreverJustificativa(posicao, contexto) {
  const groq = getCliente();
  const fallback = 'Seleção sustentada pelos números do modelo (EV e probabilidade calculados).';

  if (!groq || !posicao?.selecao) return fallback;

  try {
    const resposta = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      max_tokens: 120,
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content:
            'Você escreve justificativas curtas (1-2 frases, português do Brasil) para seleções de apostas ' +
            'esportivas já calculadas. NUNCA invente números -- use apenas os fornecidos. Cite contexto ' +
            '(Polymarket, tips) só se ele foi passado explicitamente. Seja direto, sem floreio.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            confronto: contexto.evento,
            selecao: posicao,
            fatores_de_contexto: contexto.fatoresIncerteza || [],
          }),
        },
      ],
    });

    const texto = resposta.choices?.[0]?.message?.content?.trim();
    return texto || fallback;
  } catch (erro) {
    console.warn(`[GROQ JUSTIFICATIVA] Falha ao gerar texto (fail-open): ${erro.message}`);
    return fallback;
  }
}

module.exports = { escreverJustificativa };
