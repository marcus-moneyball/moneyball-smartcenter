'use strict';

const { GoogleGenAI } = require('@google/genai');

/**
 * Estrutura o texto livre de contexto (desfalques, clima, notícias -- que o
 * usuário já pesquisou manualmente antes de colar) em fatores utilizáveis
 * pelo cálculo do Pro (mesmo formato que fatores_incerteza já usa lá:
 * calcular_nivel_confianca_dados). SEM ferramenta de busca -- só interpreta
 * o que foi dado, não procura nada novo. Isso é o que mantém essa etapa
 * barata (sem cobrança de grounding).
 *
 * Fail-open: se vazio ou falhar, devolve lista vazia -- nunca bloqueia o
 * resto do pipeline por causa disso.
 */

let cliente = null;
function getCliente() {
  if (cliente) return cliente;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  cliente = new GoogleGenAI({ apiKey });
  return cliente;
}

/**
 * @param {string} contextoInvestigado - texto livre fornecido pelo usuário
 * @returns {Promise<Object[]>} lista de { tipo, descricao, impact_level }
 */
async function estruturarContexto(contextoInvestigado) {
  const genAI = getCliente();
  if (!genAI || !contextoInvestigado?.trim()) return [];

  const prompt = `Leia o texto abaixo (contexto já pesquisado por um analista humano sobre uma partida) e
extraia os fatores relevantes em formato estruturado. NÃO busque informação nova -- use SOMENTE o que
está escrito abaixo.

TEXTO:
"""
${contextoInvestigado}
"""

Retorne ESTRITAMENTE um JSON no formato:
{ "fatores": [{ "tipo": string, "descricao": string, "impact_level": "low"|"medium"|"high" }] }

Regras:
- Um item por fator distinto (desfalque, clima, notícia, tendência mencionada).
- "impact_level" é seu julgamento de quanto isso pode pesar no resultado -- "high" só para coisas como
  ausência de titular importante ou condição climática extrema.
- Se o texto não tiver nada de relevante, retorne { "fatores": [] }.`;

  try {
    const resultado = await genAI.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: { temperature: 0 }, // sem tools -- só interpretação, sem busca
    });

    const texto = resultado.text.trim().replace(/^```json\s*|\s*```$/g, '');
    const json = JSON.parse(texto);
    return Array.isArray(json.fatores) ? json.fatores : [];
  } catch (erro) {
    console.warn(`[INTERPRETAR CONTEXTO] Falha ao estruturar (fail-open, seguindo sem fatores): ${erro.message}`);
    return [];
  }
}

module.exports = { estruturarContexto };
