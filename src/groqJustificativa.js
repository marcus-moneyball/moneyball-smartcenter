'use strict';

const Groq = require('groq-sdk');

/**
 * Groq é usado EXCLUSIVAMENTE para escrever texto -- nunca para calcular ou
 * decidir nada. A estrutura do relatório (Ouro/Prata/Bronze, odds,
 * probabilidades) é 100% determinística e vem do Pro; o Groq só recebe
 * esses números prontos + o contexto investigado e escreve em cima.
 *
 * UMA chamada por partida (não mais uma por posição do pódio) -- mais
 * barato E mais rico: gera a análise completa da partida (300-500
 * palavras, ancorada nos números reais) e as legendas curtas de cada
 * posição na mesma resposta.
 *
 * Fail-open: se falhar, cai num texto padrão simples -- nunca quebra o
 * relatório por causa disso.
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

const FALLBACK_CURTA = 'Seleção sustentada pelos números do modelo (EV e probabilidade calculados).';
const FALLBACK_ANALISE = 'Análise indisponível no momento -- seleção sustentada pelos números do modelo (EV e probabilidade calculados).';

/**
 * @param {Object} evento - { time_a, time_b, esporte, liga }
 * @param {Object} podioBruto - { ouro, prata, bronze } cada um com { mercado, selecao, odd, probabilidade_estimada, ev } ou null
 * @param {Object[]} fatoresIncerteza - contexto investigado (Polymarket, tips, etc), pode ser vazio
 * @returns {Promise<{ analiseCompleta: string, ouro: string|null, prata: string|null, bronze: string|null }>}
 */
async function escreverAnalisePartida(evento, podioBruto, fatoresIncerteza = []) {
  const groq = getCliente();

  const posicoesComSelecao = ['ouro', 'prata', 'bronze'].filter((k) => podioBruto[k]?.selecao);

  const fallback = {
    analiseCompleta: FALLBACK_ANALISE,
    ouro: podioBruto.ouro?.selecao ? FALLBACK_CURTA : null,
    prata: podioBruto.prata?.selecao ? FALLBACK_CURTA : null,
    bronze: podioBruto.bronze?.selecao ? FALLBACK_CURTA : null,
  };

  if (!groq || posicoesComSelecao.length === 0) return fallback;

  try {
    const resposta = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      max_tokens: 900,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Você escreve análises de apostas esportivas em português do Brasil, no estilo de um analista
quantitativo experiente (pense em relatórios tipo Action Network) -- direto, mas fundamentado nos números.

REGRAS INEGOCIÁVEIS:
- NUNCA invente números, estatísticas ou fatos que não foram fornecidos. Use APENAS os dados do JSON de entrada.
- Cite o EV e a probabilidade estimada explicitamente na análise, com os valores exatos fornecidos -- não arredonde de forma que mude o sentido.
- Se fatores_de_contexto foram fornecidos, incorpore-os na análise. Se a lista estiver vazia, não mencione contexto nenhum -- não invente narrativa de "clima do jogo" ou "momento da equipe" sem dado real.
- Retorne ESTRITAMENTE um JSON no formato:
  { "analise_completa": string, "justificativa_ouro": string|null, "justificativa_prata": string|null, "justificativa_bronze": string|null }
- "analise_completa": 300 a 500 palavras. Discuta o confronto, o que os números calculados indicam, e feche com a leitura de risco (odds mínima que ainda vale a pena, se fizer sentido a partir dos dados).
- "justificativa_X": 1-2 frases curtas, uma por posição do pódio que tiver seleção (null se a posição não tiver seleção).`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            confronto: evento,
            podio: podioBruto,
            fatores_de_contexto: fatoresIncerteza,
          }),
        },
      ],
    });

    const texto = resposta.choices?.[0]?.message?.content?.trim();
    const json = JSON.parse(texto);

    return {
      analiseCompleta: json.analise_completa || fallback.analiseCompleta,
      ouro: json.justificativa_ouro ?? fallback.ouro,
      prata: json.justificativa_prata ?? fallback.prata,
      bronze: json.justificativa_bronze ?? fallback.bronze,
    };
  } catch (erro) {
    console.warn(`[GROQ ANALISE] Falha ao gerar texto (fail-open): ${erro.message}`);
    return fallback;
  }
}

module.exports = { escreverAnalisePartida };
