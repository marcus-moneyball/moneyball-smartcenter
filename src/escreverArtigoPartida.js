'use strict';

const Groq = require('groq-sdk');

let cliente = null;
function getCliente() {
  if (cliente) return cliente;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  cliente = new Groq({ apiKey });
  return cliente;
}

const FALLBACK = 'Análise indisponível no momento -- consulte a tabela de odds e os destaques calculados abaixo.';

/**
 * @param {Object} confronto - { match, league, data_hora }
 * @param {Object[]} mercadosVisiveis - todos os mercados do JSON de entrada (pra tabela de odds)
 * @param {Object[]} destaques - mercados que o Pro calculou com EV positivo: { mercado, selecao, odd, probabilidade_estimada, ev }
 * @param {Object[]} fatoresContexto - fatores estruturados (ver interpretarContexto.js)
 * @returns {Promise<string>} texto da análise em prosa (HTML simples: parágrafos)
 */
async function escreverArtigoPartida(confronto, mercadosVisiveis, destaques, fatoresContexto = [], resumoNarrativoNexus = '') {
  const groq = getCliente();
  if (!groq) return FALLBACK;

  try {
    const resposta = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      max_tokens: 700,
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content: `Você escreve análises de apostas esportivas em português do Brasil, estilo Action Network --
direto, fundamentado nos números fornecidos, sem floreio.

REGRAS INEGOCIÁVEIS:
- NUNCA invente números, estatísticas ou fatos que não foram fornecidos no JSON de entrada.
- Cite EV e probabilidade explicitamente para cada destaque, com os valores exatos fornecidos.
- Se "resumo_narrativo_investigacao" foi fornecido, use-o como base para o parágrafo de contexto -- ele já
  foi escrito por uma investigação qualitativa rigorosa, não precisa reescrever do zero, só adaptar o tom.
- Se "fatores_contexto" foi fornecido, incorpore na análise. Se ambos vazios, não invente narrativa de contexto.
- Escreva 3-5 parágrafos em HTML simples (<p>...</p>), sem markdown, sem título (o título já existe fora daqui).
- Se "destaques" estiver vazio, diga isso claramente -- não force uma recomendação onde o cálculo não achou vantagem real.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            confronto,
            mercados_visiveis: mercadosVisiveis,
            destaques,
            fatores_contexto: fatoresContexto,
            resumo_narrativo_investigacao: resumoNarrativoNexus,
          }),
        },
      ],
    });

    return resposta.choices?.[0]?.message?.content?.trim() || FALLBACK;
  } catch (erro) {
    console.warn(`[ESCREVER ARTIGO] Falha ao gerar texto (fail-open): ${erro.message}`);
    return FALLBACK;
  }
}

module.exports = { escreverArtigoPartida };
