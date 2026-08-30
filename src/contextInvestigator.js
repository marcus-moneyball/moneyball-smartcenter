'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * O "investigador" do SmartCenter. Papel diferente do Groq (que só escreve
 * o texto final do relatório): o Gemini aqui INVESTIGA o contexto de uma
 * partida -- cruza odds, estatísticas, sinais do Polymarket e tips de
 * tipsters -- e devolve:
 *   1. uma lista de fatores_incerteza (mesmo formato que o Pro já consome
 *      em calcular_nivel_confianca_dados: { tipo, descricao, impact_level })
 *   2. uma recomendação de filtro (aprovado_pelo_investigador) -- este é o
 *      "meio que filtra o radar" que hoje o Gemini já faz: uma segunda
 *      camada de filtro além do filtroQualidade.js estrutural, mas
 *      baseada em julgamento de contexto, não completude de dados.
 *
 * Fail-open: se o Gemini falhar ou a chave não estiver configurada, devolve
 * lista vazia e aprovado=true -- nunca bloqueia a rodada por causa disso
 * (mesmo princípio do resto do sistema).
 */

let clienteGemini = null;
function getClienteGemini() {
  if (clienteGemini) return clienteGemini;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  clienteGemini = new GoogleGenerativeAI(apiKey);
  return clienteGemini;
}

/**
 * @param {Object} contexto
 * @param {Object} contexto.evento - { time_a, time_b, esporte, liga }
 * @param {Object} [contexto.polymarket] - dados do Polymarket para o evento, se houver
 * @param {Object[]} [contexto.tips] - tips de tipsters relevantes ao evento, se houver
 * @returns {Promise<{ fatoresIncerteza: Object[], aprovadoPeloInvestigador: boolean, motivo: string|null }>}
 */
async function investigarContexto({ evento, polymarket = null, tips = [] }) {
  const genAI = getClienteGemini();

  // Sem tips e sem Polymarket ainda não há muito o que investigar além do
  // que o filtroQualidade.js já mede estruturalmente -- não vale a chamada.
  if (!genAI || (!polymarket && tips.length === 0)) {
    return { fatoresIncerteza: [], aprovadoPeloInvestigador: true, motivo: null };
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Você é um investigador de contexto para apostas esportivas.
Partida: ${evento.time_a} x ${evento.time_b} (${evento.esporte}, ${evento.liga || 'liga não informada'}).

${polymarket ? `Dados do Polymarket: ${JSON.stringify(polymarket)}` : 'Sem dados do Polymarket para esta partida.'}
${tips.length ? `Tips de tipsters: ${JSON.stringify(tips)}` : 'Sem tips de tipsters para esta partida.'}

Responda SOMENTE em JSON, sem markdown, no formato:
{
  "fatores_incerteza": [{ "tipo": string, "descricao": string, "impact_level": "low"|"medium"|"high" }],
  "aprovado": boolean,
  "motivo": string | null
}
Regras:
- "fatores_incerteza": inclua um item para cada divergência relevante entre Polymarket e odds de mercado, e para cada tip que contradiga ou reforce fortemente o consenso.
- "aprovado" = false APENAS se o contexto disponível for contraditório ou insuficiente a ponto de tornar qualquer prognóstico irresponsável (ex: tips e Polymarket fortemente conflitantes sem explicação plausível). Na dúvida, aprove.`;

    const resultado = await model.generateContent(prompt);
    const texto = resultado.response.text().trim().replace(/^```json\s*|\s*```$/g, '');
    const json = JSON.parse(texto);

    return {
      fatoresIncerteza: Array.isArray(json.fatores_incerteza) ? json.fatores_incerteza : [],
      aprovadoPeloInvestigador: json.aprovado !== false,
      motivo: json.motivo || null,
    };
  } catch (erro) {
    console.warn(`[CONTEXT INVESTIGATOR] Falha ao investigar (fail-open, seguindo aprovado): ${erro.message}`);
    return { fatoresIncerteza: [], aprovadoPeloInvestigador: true, motivo: null };
  }
}

module.exports = { investigarContexto };
